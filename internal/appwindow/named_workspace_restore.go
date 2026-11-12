package appwindow

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/luxury-yacht/app/internal/panelwindow"
	"github.com/wailsapp/wails/v3/pkg/application"
)

var errNamedWorkspaceOpenCancelled = errors.New("workspace switch cancelled by an open window")

// errReplacedWindowStaysOpen marks a previous window that is still on screen
// after the switch, as opposed to one that turned out to be gone already.
var errReplacedWindowStaysOpen = errors.New("the window stays open")

type namedWorkspaceRestoreSlot struct {
	directory *panelwindow.WorkspaceDirectory
	ready     chan error
}

type namedWorkspaceTarget struct {
	name     string
	panel    bool
	geometry panelwindow.NamedWorkspaceGeometry
	slot     *namedWorkspaceRestoreSlot
	// clusters are the cluster tabs an app window was seeded with.
	clusters []string
}

type namedWorkspaceRestore struct {
	directory *panelwindow.WorkspaceDirectory
	targets   []namedWorkspaceTarget
	seed      string
	seeded    bool
	// notFullscreen names the restored windows that did not return to fullscreen.
	notFullscreen []string

	// mu orders the commit decision against everything else that can take a
	// destination or a cluster away. It is held across the decision and the
	// directory swap, so a close either aborts the switch or happens to a window
	// of the committed workspace, never in between.
	mu      sync.Mutex
	failure error
	decided bool
}

func (restore *namedWorkspaceRestore) hasTarget(name string) bool {
	restore.mu.Lock()
	defer restore.mu.Unlock()
	return restore.hasTargetLocked(name)
}

func (restore *namedWorkspaceRestore) hasTargetLocked(name string) bool {
	return slices.ContainsFunc(restore.targets, func(target namedWorkspaceTarget) bool { return target.name == name })
}

// stages reports whether name is a destination the switch has not yet committed.
func (restore *namedWorkspaceRestore) stages(name string) bool {
	restore.mu.Lock()
	defer restore.mu.Unlock()
	return !restore.decided && restore.hasTargetLocked(name)
}

// fail records why the switch must abort. It reports false once the switch has
// committed: from then on its windows are ordinary windows.
func (restore *namedWorkspaceRestore) fail(err error) bool {
	restore.mu.Lock()
	defer restore.mu.Unlock()
	if restore.decided {
		return false
	}
	if restore.failure == nil {
		restore.failure = err
	}
	return true
}

func (restore *namedWorkspaceRestore) failed() error {
	restore.mu.Lock()
	defer restore.mu.Unlock()
	return restore.failure
}

func (r *Registry) OpenNamedWorkspace(ctx context.Context, source string, snapshot panelwindow.NamedWorkspace) error {
	if !r.namedWorkspaceOperation.TryLock() {
		return fmt.Errorf("another workspace operation is in progress")
	}
	defer r.namedWorkspaceOperation.Unlock()
	// Decide what can be restored before any open window runs its close guards.
	available, err := r.backend.NamedWorkspaceAvailableClusters()
	if err != nil {
		return err
	}
	snapshot, missing := availableWorkspaceLayout(snapshot, available)
	if len(snapshot.AppWindows) == 0 && len(snapshot.PanelWindows) == 0 {
		return fmt.Errorf("no workspace windows can be restored; missing clusters: %v", missing)
	}
	apps, panels := r.lifecycle.Names(), r.panels.Names("")
	participants := append(slices.Clone(apps), panels...)
	guard, err := r.beginWorkspaceReplacement(source, participants)
	if err != nil {
		return err
	}
	defer r.endWorkspaceReplacement(guard.transactionID)
	if err := r.waitForWorkspaceReplacement(ctx, guard); err != nil {
		return err
	}
	revision, err := r.workspace.WorkspaceCaptureRevision()
	if err != nil {
		return err
	}
	restore := &namedWorkspaceRestore{directory: panelwindow.NewWorkspaceDirectory(), seed: "workspace-restore-" + uuid.NewString()}
	// Cleared last, after the staged or previous windows are closed.
	r.activeRestore.Store(restore)
	defer r.activeRestore.Store(nil)
	committed := false
	defer func() { r.finishNamedWorkspaceRestore(restore, committed) }()
	stageCtx, cancel := context.WithTimeout(ctx, 35*time.Second)
	defer cancel()
	if err := r.stageNamedWorkspace(stageCtx, restore, snapshot); err != nil {
		return err
	}
	replacedClusters, err := r.commitNamedWorkspace(restore, revision, apps, panels)
	if err != nil {
		return err
	}
	// The new windows own the panel directory from here. A failure past this
	// point is reported, but must never undo them.
	committed = true
	unclosed := r.retireReplacedWindows(apps, panels, replacedClusters)
	r.endWorkspaceReplacement(guard.transactionID)
	r.quitWithoutWindows()
	return r.reportCommittedWorkspace(restore, missing, unclosed)
}

// quitWithoutWindows finishes what closing the last window means. The windows
// of the new workspace are ordinary windows once the switch commits, so the
// user can close them all while the previous ones are still being retired. The
// quit that follows the last close is refused while the switch holds its
// preflight, which would leave the app running with no window.
func (r *Registry) quitWithoutWindows() {
	if r.lifecycle.Count() == 0 && len(r.panels.Names("")) == 0 && r.requestApplicationQuit != nil {
		r.requestApplicationQuit()
	}
}

// reportCommittedWorkspace tells the user what a committed switch could not do.
// The window that asked for the switch is usually one of those it closed, so
// the warning goes to a window of the new workspace. Every problem is logged;
// the caller gets an error only for previous windows that failed to close.
func (r *Registry) reportCommittedWorkspace(restore *namedWorkspaceRestore, missing []string, unclosed []error) error {
	stillOpen := 0
	for _, err := range unclosed {
		if errors.Is(err, errReplacedWindowStaysOpen) {
			stillOpen++
		}
	}
	warnings := panelwindow.NamedWorkspaceWarningsEvent{
		MissingClusters: missing, UnclosedWindows: stillOpen, NotFullscreen: len(restore.notFullscreen),
	}
	if len(missing) != 0 || stillOpen != 0 || len(restore.notFullscreen) != 0 {
		r.deliverWorkspaceWarnings(restore, warnings)
	}
	if len(restore.notFullscreen) != 0 {
		r.reportPanelLifecycleError(fmt.Errorf("windows did not return to fullscreen: %v", restore.notFullscreen), "open workspace")
	}
	if err := errors.Join(unclosed...); err != nil {
		r.reportPanelLifecycleError(err, "close replaced windows")
		return fmt.Errorf("the workspace opened, but closing the previous windows failed: %w", err)
	}
	return nil
}

func (r *Registry) deliverWorkspaceWarnings(restore *namedWorkspaceRestore, warnings panelwindow.NamedWorkspaceWarningsEvent) {
	for _, name := range r.warningWindows(restore) {
		warnings.WindowName = name
		if r.emitWindowEvent(name, panelwindow.NamedWorkspaceWarnings, warnings) {
			return
		}
	}
	r.reportPanelLifecycleError(fmt.Errorf("no window of the new workspace could show %+v", warnings), "deliver workspace warnings")
}

// warningWindows lists the open windows of the new workspace, the one the user
// is most likely looking at first: the window that entered fullscreen last has
// the display, and a window reopened minimized is not on screen at all.
func (r *Registry) warningWindows(restore *namedWorkspaceRestore) []string {
	var fullscreen, visible, minimized []string
	for _, target := range restore.targets {
		switch {
		case !r.restoredWindowOpen(target):
		case target.geometry.Minimized:
			minimized = append(minimized, target.name)
		case target.geometry.Fullscreen && !slices.Contains(restore.notFullscreen, target.name):
			fullscreen = append(fullscreen, target.name)
		default:
			visible = append(visible, target.name)
		}
	}
	slices.Reverse(fullscreen)
	return slices.Concat(fullscreen, visible, minimized)
}

func (r *Registry) restoredWindowOpen(target namedWorkspaceTarget) bool {
	if target.panel {
		_, err := r.panels.Descriptor(target.name)
		return err == nil
	}
	return r.lifecycle.Contains(target.name)
}

func (r *Registry) beginWorkspaceReplacement(source string, participants []string) (*applicationQuitPreflight, error) {
	if !r.isWorkspaceReady(source) || !slices.Equal(participants, r.readyWorkspaceNames()) {
		return nil, fmt.Errorf("wait for all windows to finish opening or moving before switching")
	}
	r.quitMu.Lock()
	defer r.quitMu.Unlock()
	if r.pendingQuit != nil {
		return nil, fmt.Errorf("another window close or workspace switch is in progress")
	}
	pending := r.beginApplicationQuitPreflightLocked(participants)
	pending.replacement = make(chan bool, 1)
	return pending, nil
}

func (r *Registry) waitForWorkspaceReplacement(ctx context.Context, guard *applicationQuitPreflight) error {
	r.emitApplicationQuitPreflight(guard, guard.participants)
	select {
	case approved := <-guard.replacement:
		if !approved {
			return errNamedWorkspaceOpenCancelled
		}
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

// Approval replaces the collected preflight, so the switch releases its windows
// by transaction rather than by the object it began with.
func (r *Registry) endWorkspaceReplacement(transactionID string) {
	r.cancelPendingApplicationQuitPreflight(func(current *applicationQuitPreflight) bool {
		return current.transactionID == transactionID
	})
}

func availableWorkspaceLayout(snapshot panelwindow.NamedWorkspace, available []string) (panelwindow.NamedWorkspace, []string) {
	next := snapshot
	next.AppWindows = make([]panelwindow.NamedWorkspaceAppWindow, 0, len(snapshot.AppWindows))
	missing := map[string]bool{}
	keep := func(id string) bool {
		if slices.Contains(available, id) {
			return true
		}
		missing[id] = true
		return false
	}
	for _, window := range snapshot.AppWindows {
		if window, restorable := availableAppWindow(window, keep); restorable {
			next.AppWindows = append(next.AppWindows, window)
		}
	}
	next.PanelWindows = slices.DeleteFunc(slices.Clone(snapshot.PanelWindows), func(panel panelwindow.NamedWorkspacePanelWindow) bool { return !keep(panel.Group.ClusterID) })
	unavailable := make([]string, 0, len(missing))
	for id := range missing {
		unavailable = append(unavailable, id)
	}
	slices.Sort(unavailable)
	return next, unavailable
}

// availableAppWindow keeps the views of one saved app window whose clusters
// keep accepts. A window that showed only missing clusters has nothing left to
// show and is not restored; a window saved without clusters is.
func availableAppWindow(window panelwindow.NamedWorkspaceAppWindow, keep func(string) bool) (panelwindow.NamedWorkspaceAppWindow, bool) {
	saved := len(window.ClusterTabs)
	window.ClusterTabs = slices.DeleteFunc(slices.Clone(window.ClusterTabs), func(tab panelwindow.NamedWorkspaceClusterTab) bool { return !keep(tab.ClusterID) })
	if saved > 0 && len(window.ClusterTabs) == 0 {
		return window, false
	}
	window.DockedGroups = slices.DeleteFunc(slices.Clone(window.DockedGroups), func(dock panelwindow.NamedWorkspaceDockedGroup) bool { return !keep(dock.Group.ClusterID) })
	if !slices.Contains(workspaceClusterIDs(window), window.SelectedClusterID) {
		window.SelectedClusterID = ""
		if len(window.ClusterTabs) > 0 {
			window.SelectedClusterID = window.ClusterTabs[0].ClusterID
		}
	}
	if len(window.ClusterTabs) < 2 {
		window.GlobalView = nil
	}
	return window, true
}

func workspaceClusterIDs(window panelwindow.NamedWorkspaceAppWindow) []string {
	ids := make([]string, 0, len(window.ClusterTabs))
	for _, tab := range window.ClusterTabs {
		ids = append(ids, tab.ClusterID)
	}
	return ids
}

func (r *Registry) stageNamedWorkspace(ctx context.Context, restore *namedWorkspaceRestore, snapshot panelwindow.NamedWorkspace) error {
	clusters := namedWorkspaceSelections(snapshot)
	if len(clusters) != 0 {
		restore.seeded = true
		if err := r.backend.SeedNamedWorkspaceWindow(restore.seed, clusters, ""); err != nil {
			return err
		}
	}
	for _, window := range snapshot.AppWindows {
		if err := r.stageNamedAppWindow(restore, window); err != nil {
			return err
		}
	}
	for _, panel := range snapshot.PanelWindows {
		if err := r.stageNamedPanelWindow(restore, panel); err != nil {
			return err
		}
	}
	return waitForRestoredWindows(ctx, restore.targets)
}

func waitForRestoredWindows(ctx context.Context, targets []namedWorkspaceTarget) error {
	for _, target := range targets {
		select {
		case err := <-target.slot.ready:
			if err != nil {
				return fmt.Errorf("restore window %q: %w", target.name, err)
			}
		case <-ctx.Done():
			return fmt.Errorf("waiting for window %q: %w", target.name, ctx.Err())
		}
	}
	return nil
}

func namedWorkspaceSelections(snapshot panelwindow.NamedWorkspace) []string {
	var ids []string
	for _, window := range snapshot.AppWindows {
		ids = append(ids, workspaceClusterIDs(window)...)
	}
	for _, panel := range snapshot.PanelWindows {
		ids = append(ids, panel.Group.ClusterID)
	}
	slices.Sort(ids)
	return slices.Compact(ids)
}

func (r *Registry) addNamedWorkspaceTarget(restore *namedWorkspaceRestore, name string, panel bool, geometry panelwindow.NamedWorkspaceGeometry, clusters []string) {
	slot := &namedWorkspaceRestoreSlot{directory: restore.directory, ready: make(chan error, 1)}
	r.workspaceRestoreSlots.Store(name, slot)
	restore.mu.Lock()
	restore.targets = append(restore.targets, namedWorkspaceTarget{name: name, panel: panel, geometry: geometry, slot: slot, clusters: clusters})
	restore.mu.Unlock()
}

func (r *Registry) stageNamedAppWindow(restore *namedWorkspaceRestore, state panelwindow.NamedWorkspaceAppWindow) error {
	name := r.lifecycle.Add()
	r.addNamedWorkspaceTarget(restore, name, false, state.Geometry, workspaceClusterIDs(state))
	if err := r.backend.SeedNamedWorkspaceWindow(name, workspaceClusterIDs(state), state.SelectedClusterID); err != nil {
		return err
	}
	for _, dock := range state.DockedGroups {
		if err := restore.directory.StageNamedWorkspaceGroup(name, panelwindow.PanelLocationDocked, dock.Group); err != nil {
			return err
		}
	}
	if !r.queueWorkspaceEvent(name, panelwindow.NamedWorkspaceRestoreRequested, panelwindow.NamedWorkspaceRestoreRequest{WindowName: name, Window: state}) {
		return fmt.Errorf("could not queue the restored app window")
	}
	window := r.newWindow(r.namedWorkspaceWindowOptions(windowOptions(name), state.Geometry))
	if window == nil {
		return fmt.Errorf("could not create app window %q", name)
	}
	r.registerLifecycleHooks(window, name, false)
	return nil
}

func (r *Registry) stageNamedPanelWindow(restore *namedWorkspaceRestore, state panelwindow.NamedWorkspacePanelWindow) error {
	group := state.Group
	group.GroupID = uuid.NewString()
	request := panelwindow.GroupSnapshot{
		SchemaVersion: panelwindow.GroupSchemaVersion, TransferID: uuid.NewString(), SourceWindowName: restore.seed,
		ClusterID: group.ClusterID, GroupID: group.GroupID, Tabs: group.Tabs, ActivePanelID: group.ActivePanelID,
	}
	descriptor, err := r.panels.BeginOpen(request)
	if err != nil {
		return err
	}
	name := descriptor.WindowName
	r.addNamedWorkspaceTarget(restore, name, true, state.Geometry, nil)
	if err := r.backend.RetainPanelCluster(name, group.ClusterID); err != nil {
		return err
	}
	if err := restore.directory.StageNamedWorkspaceGroup(name, panelwindow.PanelLocationWindow, group); err != nil {
		return err
	}
	options := r.namedWorkspaceWindowOptions(r.transferredPanelWindowOptions(name, request), state.Geometry)
	window := r.newWindow(options)
	if window == nil {
		return fmt.Errorf("could not create panel window %q", name)
	}
	if r.configurePanelWindow != nil {
		r.configurePanelWindow(window)
	}
	r.registerPanelLifecycleHooks(window, name)
	return nil
}

func (r *Registry) namedWorkspaceWindowOptions(options application.WebviewWindowOptions, geometry panelwindow.NamedWorkspaceGeometry) application.WebviewWindowOptions {
	bounds, positioned := r.backend.ResolveNamedWorkspaceGeometry(geometry)
	options.Hidden = true
	options.Width, options.Height = bounds.Width, bounds.Height
	if positioned {
		options.Screen = nil
		options.InitialPosition = application.WindowXY
		options.X, options.Y = bounds.X, bounds.Y
	}
	return options
}

func (r *Registry) workspaceDirectoryFor(name string) *panelwindow.WorkspaceDirectory {
	if slot, staged := r.workspaceRestoreSlots.Load(name); staged {
		return slot.(*namedWorkspaceRestoreSlot).directory
	}
	return r.workspace
}

func (r *Registry) AcknowledgeNamedWorkspaceRestore(name, failure string) error {
	value, exists := r.workspaceRestoreSlots.Load(name)
	if !exists {
		return fmt.Errorf("window %q is not being restored", name)
	}
	var err error
	if failure != "" {
		err = errors.New(failure)
	}
	select {
	case value.(*namedWorkspaceRestoreSlot).ready <- err:
		return nil
	default:
		return fmt.Errorf("window %q already acknowledged restoration", name)
	}
}

func (r *Registry) verifyRestoredWindowInventory(targets []namedWorkspaceTarget, apps, panels []string) error {
	expectedApps, expectedPanels := slices.Clone(apps), slices.Clone(panels)
	for _, target := range targets {
		if target.panel {
			expectedPanels = append(expectedPanels, target.name)
		} else {
			expectedApps = append(expectedApps, target.name)
		}
	}
	slices.Sort(expectedApps)
	slices.Sort(expectedPanels)
	if !slices.Equal(expectedApps, r.lifecycle.Names()) || !slices.Equal(expectedPanels, r.panels.Names("")) {
		return fmt.Errorf("windows changed while opening the workspace")
	}
	return nil
}

func (r *Registry) prepareRestoredWindows(restore *namedWorkspaceRestore) error {
	for _, cluster := range restore.directory.RestoredWorkspaceClusters() {
		if err := r.retainPanelWorkspace(cluster); err != nil {
			return err
		}
	}
	for _, target := range restore.targets {
		if !r.showWindow(target.name) {
			return fmt.Errorf("restored window %q disappeared before it could be shown", target.name)
		}
		r.applyNamedWorkspaceBounds(target)
		if !target.geometry.Fullscreen {
			r.restoreWindowState(target.name, target.geometry)
		}
	}
	// A fullscreen transition takes over the display while it runs, and a window
	// maximized during it is left part-way. Fullscreen is entered once every
	// other window has its state.
	for _, target := range restore.targets {
		if target.geometry.Fullscreen && !r.restoreWindowState(target.name, target.geometry) {
			restore.notFullscreen = append(restore.notFullscreen, target.name)
		}
	}
	return nil
}

// commitNamedWorkspace hands the panel directory to the restored windows. It
// returns the clusters the replaced windows held, for release once they close.
func (r *Registry) commitNamedWorkspace(restore *namedWorkspaceRestore, revision uint64, apps, panels []string) ([]string, error) {
	if err := r.restoredWindowsIntact(restore, apps, panels); err != nil {
		return nil, err
	}
	if err := r.prepareRestoredWindows(restore); err != nil {
		return nil, err
	}
	// Showing and placing the windows takes time, and a fullscreen transition
	// takes seconds. Whatever took a destination or a cluster away meanwhile
	// aborts the switch while the previous windows are still open. The decision
	// and the swap share one hold of the lock, so nothing can do so in between.
	restore.mu.Lock()
	defer restore.mu.Unlock()
	if restore.failure != nil {
		return nil, restore.failure
	}
	if err := r.verifyRestoredWindows(restore.targets, apps, panels); err != nil {
		return nil, err
	}
	replacedClusters := r.workspace.RestoredWorkspaceClusters()
	if err := r.workspace.CommitNamedWorkspace(restore.directory, revision); err != nil {
		return nil, err
	}
	for _, target := range restore.targets {
		r.workspaceRestoreSlots.Delete(target.name)
	}
	restore.decided = true
	return replacedClusters, nil
}

func (r *Registry) restoredWindowsIntact(restore *namedWorkspaceRestore, apps, panels []string) error {
	if err := restore.failed(); err != nil {
		return err
	}
	return r.verifyRestoredWindows(restore.targets, apps, panels)
}

// verifyRestoredWindows checks the destinations are all still there and still
// hold the clusters they were seeded with. The backend's record of a window's
// clusters is the authority: a cluster that went away meanwhile is no longer in
// it, however and whenever its removal is announced.
func (r *Registry) verifyRestoredWindows(targets []namedWorkspaceTarget, apps, panels []string) error {
	if err := r.verifyRestoredWindowInventory(targets, apps, panels); err != nil {
		return err
	}
	for _, target := range targets {
		if target.panel {
			continue
		}
		held := r.backend.WindowClusterIDs(target.name)
		if !slices.Equal(slices.Sorted(slices.Values(held)), slices.Sorted(slices.Values(target.clusters))) {
			return fmt.Errorf("clusters changed in window %q while the workspace was opening", target.name)
		}
	}
	return nil
}

// retireReplacedWindows closes the windows the committed workspace replaced.
// The switch can no longer be undone, so every window is attempted. It returns
// one error for each window that did not close.
func (r *Registry) retireReplacedWindows(apps, panels, replacedClusters []string) []error {
	var failures []error
	for _, panel := range panels {
		if err := r.closePanelWindow(panel, true); err != nil {
			failures = append(failures, err)
		}
	}
	for _, app := range apps {
		if err := r.closeReplacedAppWindow(app); err != nil {
			failures = append(failures, err)
		}
	}
	for _, cluster := range replacedClusters {
		r.releaseUnusedPanelWorkspace(cluster)
	}
	for _, clusterID := range r.workspace.RestoredWorkspaceClusters() {
		r.emitWorkspaceChanged(clusterID)
	}
	return failures
}

// closeReplacedAppWindow ends an app view the committed workspace replaced.
// The native close only queues the close hook, so a refusal there would go
// unseen. Running the view's close here first settles it: a view still tracked
// afterwards refused and stays open, and the queued hook finds nothing to refuse.
func (r *Registry) closeReplacedAppWindow(name string) error {
	r.authorizeClose(name)
	r.handleClosing(nil, name)
	if r.lifecycle.Contains(name) {
		return fmt.Errorf("app window %q could not be closed: %w", name, errReplacedWindowStaysOpen)
	}
	if !r.closeAuthorizedWindow(name) {
		return fmt.Errorf("app window %q had no native window to close", name)
	}
	return nil
}

// applyNamedWorkspaceBounds places a restored window and remembers those bounds
// before its saved state changes them, so a workspace saved again keeps the
// bounds this window returns to.
func (r *Registry) applyNamedWorkspaceBounds(target namedWorkspaceTarget) {
	r.placeNamedWorkspaceWindow(target)
	r.rememberNamedWorkspaceBounds(target.name)
}

func (r *Registry) placeNamedWorkspaceWindow(target namedWorkspaceTarget) {
	if r.application == nil {
		return
	}
	window, ok := r.application.Window.GetByName(target.name)
	if !ok {
		return
	}
	bounds, positioned := r.backend.ResolveNamedWorkspaceGeometry(target.geometry)
	window.SetSize(bounds.Width, bounds.Height)
	if positioned {
		window.SetPosition(bounds.X, bounds.Y)
	}
}

func (r *Registry) finishNamedWorkspaceRestore(restore *namedWorkspaceRestore, committed bool) {
	if !committed {
		for _, target := range restore.targets {
			if target.panel {
				r.closeAuthorizedWindow(target.name)
				r.panels.Remove(target.name)
				r.reportPanelLifecycleError(r.releaseNativePanelReference(target.name), "release staged panel")
			} else if !r.closeAuthorizedWindow(target.name) {
				r.lifecycle.BeginClose(target.name)
				r.forgetWorkspaceReady(target.name)
				r.backend.ReleaseWorkspaceWindow(target.name)
			}
			r.workspaceRestoreSlots.Delete(target.name)
		}
		for _, cluster := range restore.directory.RestoredWorkspaceClusters() {
			r.releaseUnusedPanelWorkspace(cluster)
		}
	}
	if restore.seeded {
		r.backend.ReleaseWorkspaceWindow(restore.seed)
	}
}
