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

// How long the saved windows get to load their views before they are shown as
// they are.
const defaultNamedWorkspaceRestoreTimeout = 35 * time.Second

// namedWorkspaceReply is a restored window's one answer: its saved view is
// mounted, or why it is not.
type namedWorkspaceReply struct {
	window string
	err    error
}

type namedWorkspaceTarget struct {
	name     string
	panel    bool
	geometry panelwindow.NamedWorkspaceGeometry
}

// namedWorkspaceRestore is the workspace being opened: the windows the switch
// created and what could not be done for them. Nothing here can be undone, so
// it records problems for the user instead of deciding whether to go on.
type namedWorkspaceRestore struct {
	seed   string
	seeded bool
	// notFullscreen names the windows that did not return to fullscreen.
	notFullscreen []string
	// unrestored counts saved windows that could not be created or did not
	// mount their saved view.
	unrestored int

	mu       sync.Mutex
	targets  []namedWorkspaceTarget
	answered map[string]bool
	// replies carries each window's answer as it arrives.
	replies chan namedWorkspaceReply
}

func (restore *namedWorkspaceRestore) addTarget(target namedWorkspaceTarget) {
	restore.mu.Lock()
	defer restore.mu.Unlock()
	restore.targets = append(restore.targets, target)
}

// dropTarget forgets a saved window that could not be created.
func (restore *namedWorkspaceRestore) dropTarget(name string) {
	restore.mu.Lock()
	defer restore.mu.Unlock()
	restore.targets = slices.DeleteFunc(restore.targets, func(target namedWorkspaceTarget) bool { return target.name == name })
}

func (restore *namedWorkspaceRestore) hasTarget(name string) bool {
	restore.mu.Lock()
	defer restore.mu.Unlock()
	return slices.ContainsFunc(restore.targets, func(target namedWorkspaceTarget) bool { return target.name == name })
}

// answer records a window's one reply. It reports false for a second one.
func (restore *namedWorkspaceRestore) answer(window string, err error) bool {
	restore.mu.Lock()
	defer restore.mu.Unlock()
	if restore.answered[window] {
		return false
	}
	restore.answered[window] = true
	// Buffered for every saved window, and each answers once.
	restore.replies <- namedWorkspaceReply{window: window, err: err}
	return true
}

// previousWindows are the windows a switch closed and whose backend holds it
// still has to release.
type previousWindows struct {
	apps, panels []string
}

// OpenNamedWorkspace closes the current windows and opens a saved arrangement
// in their place. Until the panel directory is handed over, a refusal leaves
// the current workspace as it was. After that nothing is rolled back: the
// previous windows close, and whatever cannot be restored is reported in the
// new workspace.
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
	destinations := len(snapshot.AppWindows) + len(snapshot.PanelWindows)
	if destinations == 0 {
		return fmt.Errorf("no workspace windows can be restored; missing clusters: %v", missing)
	}
	apps, panels := r.lifecycle.Names(), r.panels.Names("")
	guard, err := r.beginWorkspaceReplacement(source, append(slices.Clone(apps), panels...))
	if err != nil {
		return err
	}
	// Quit stays refused until this returns, which covers the moment between
	// the previous windows closing and the new ones appearing.
	defer r.endWorkspaceReplacement(guard.transactionID)
	if err := r.waitForWorkspaceReplacement(ctx, guard); err != nil {
		return err
	}
	restore := &namedWorkspaceRestore{
		seed:    "workspace-restore-" + uuid.NewString(),
		replies: make(chan namedWorkspaceReply, destinations), answered: make(map[string]bool, destinations),
	}
	r.activeRestore.Store(restore)
	defer r.activeRestore.Store(nil)
	replacedClusters, err := r.handOverPanelDirectory(ctx, restore, snapshot)
	if err != nil {
		return err
	}
	// Nothing past this point is undone.
	r.createRestoredWindows(restore, snapshot)
	if len(restore.targets) == 0 {
		r.backend.ReleaseWorkspaceWindow(restore.seed)
		return fmt.Errorf("no window of the workspace could be created; the current windows stay open without their panels")
	}
	previous, unclosed := r.closePreviousWindows(apps, panels)
	r.waitForRestoredWindows(restore)
	r.presentRestoredWindows(restore)
	r.endWorkspaceReplacement(guard.transactionID)
	result := r.reportOpenedWorkspace(restore, missing, unclosed)
	// The releases can wait behind cluster connections the new workspace
	// started, so they come after its windows are on screen and usable.
	r.releasePreviousWindows(previous, replacedClusters)
	r.backend.ReleaseWorkspaceWindow(restore.seed)
	// Claiming the saved clusters did not touch what the next launch opens.
	r.backend.PersistRestartSelection()
	r.quitWithoutWindows()
	return result
}

// handOverPanelDirectory claims the saved clusters and drops every panel of the
// current workspace from the directory. It is the last step that can refuse:
// the directory rejects the hand-over if anything changed it since the windows
// approved, a removed cluster included. It returns the clusters whose panel
// workspaces the previous windows held.
func (r *Registry) handOverPanelDirectory(ctx context.Context, restore *namedWorkspaceRestore, snapshot panelwindow.NamedWorkspace) ([]string, error) {
	revision, err := r.workspace.WorkspaceCaptureRevision()
	if err != nil {
		return nil, err
	}
	// One seed claims every saved cluster, so a cluster both workspaces show
	// stays connected and each window's own seed takes the fast path.
	if clusters := namedWorkspaceSelections(snapshot); len(clusters) != 0 {
		if err := r.backend.SeedNamedWorkspaceWindow(restore.seed, clusters, ""); err != nil {
			return nil, err
		}
		restore.seeded = true
	}
	// A cancelled request must not go on to close the current windows.
	err = ctx.Err()
	replacedClusters := r.workspace.RestoredWorkspaceClusters()
	if err == nil {
		err = r.workspace.CommitNamedWorkspace(panelwindow.NewWorkspaceDirectory(), revision)
	}
	if err != nil {
		if restore.seeded {
			r.backend.ReleaseWorkspaceWindow(restore.seed)
		}
		return nil, err
	}
	return replacedClusters, nil
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

// reportOpenedWorkspace tells the user what the switch could not do. The window
// that asked for it is closed, so the warning goes to a window of the new
// workspace. Every problem is logged; the caller gets an error only for
// previous windows that failed to close.
func (r *Registry) reportOpenedWorkspace(restore *namedWorkspaceRestore, missing []string, unclosed []error) error {
	stillOpen := 0
	for _, err := range unclosed {
		if errors.Is(err, errReplacedWindowStaysOpen) {
			stillOpen++
		}
	}
	warnings := panelwindow.NamedWorkspaceWarningsEvent{
		MissingClusters: missing, UnclosedWindows: stillOpen,
		UnrestoredWindows: restore.unrestored, NotFullscreen: len(restore.notFullscreen),
	}
	if len(missing) != 0 || stillOpen != 0 || restore.unrestored != 0 || len(restore.notFullscreen) != 0 {
		r.deliverWorkspaceWarnings(restore, warnings)
	}
	if len(restore.notFullscreen) != 0 {
		r.reportPanelLifecycleError(fmt.Errorf("windows did not return to fullscreen: %v", restore.notFullscreen), "open workspace")
	}
	if err := errors.Join(unclosed...); err != nil {
		r.reportPanelLifecycleError(err, "close previous windows")
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
	if !r.rendererReady(source) || !slices.Equal(participants, r.readyWorkspaceNames()) || r.clusterViewMoving() {
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

// createRestoredWindows creates the saved windows, hidden, as ordinary windows
// of the workspace that is now live. They exist before the previous windows
// close because Windows and Linux end the process the moment no window is left.
// A window that cannot be created is counted and the rest carry on.
func (r *Registry) createRestoredWindows(restore *namedWorkspaceRestore, snapshot panelwindow.NamedWorkspace) {
	for _, window := range snapshot.AppWindows {
		if err := r.createRestoredAppWindow(restore, window); err != nil {
			restore.unrestored++
			r.reportPanelLifecycleError(err, "restore app window")
		}
	}
	for _, panel := range snapshot.PanelWindows {
		if err := r.createRestoredPanelWindow(restore, panel); err != nil {
			restore.unrestored++
			r.reportPanelLifecycleError(err, "restore panel window")
		}
	}
}

// waitForRestoredWindows gives the new windows time to mount their saved views
// before they are shown. One that fails, or has not answered by the deadline,
// is shown as it is and counted.
func (r *Registry) waitForRestoredWindows(restore *namedWorkspaceRestore) {
	deadline := time.After(r.namedWorkspaceRestoreTimeout)
	for waiting := len(restore.targets); waiting > 0; waiting-- {
		select {
		case reply := <-restore.replies:
			if reply.err != nil {
				restore.unrestored++
				r.reportPanelLifecycleError(fmt.Errorf("restore window %q: %w", reply.window, reply.err), "open workspace")
			}
		case <-deadline:
			restore.unrestored += waiting
			r.reportPanelLifecycleError(fmt.Errorf("%d restored windows did not finish loading", waiting), "open workspace")
			return
		}
	}
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

// placeRestoredGroup puts a saved panel group in the directory for its window
// and keeps its cluster's panel workspace alive.
func (r *Registry) placeRestoredGroup(window string, kind panelwindow.PanelLocationKind, group panelwindow.WorkspaceGroup) error {
	if err := r.retainPanelWorkspace(group.ClusterID); err != nil {
		return err
	}
	return r.workspace.StageNamedWorkspaceGroup(window, kind, group)
}

func (r *Registry) createRestoredAppWindow(restore *namedWorkspaceRestore, state panelwindow.NamedWorkspaceAppWindow) error {
	name := r.lifecycle.Add()
	err := r.backend.SeedNamedWorkspaceWindow(name, workspaceClusterIDs(state), state.SelectedClusterID)
	for i := 0; err == nil && i < len(state.DockedGroups); i++ {
		err = r.placeRestoredGroup(name, panelwindow.PanelLocationDocked, state.DockedGroups[i].Group)
	}
	if err == nil && !r.queueWorkspaceEvent(name, panelwindow.NamedWorkspaceRestoreRequested, panelwindow.NamedWorkspaceRestoreRequest{WindowName: name, Window: state}) {
		err = fmt.Errorf("could not queue the restored app window")
	}
	// Listed before its native window exists: the window's first events ask
	// whether the switch is restoring it.
	restore.addTarget(namedWorkspaceTarget{name: name, geometry: state.Geometry})
	var window *application.WebviewWindow
	if err == nil {
		if window = r.newWindow(r.namedWorkspaceWindowOptions(windowOptions(name), state.Geometry)); window == nil {
			err = fmt.Errorf("could not create app window %q", name)
		}
	}
	if err != nil {
		r.discardRestoredAppWindow(restore, name)
		return err
	}
	r.registerLifecycleHooks(window, name, false)
	return nil
}

// discardRestoredAppWindow gives up a saved app window that could not be created.
func (r *Registry) discardRestoredAppWindow(restore *namedWorkspaceRestore, name string) {
	restore.dropTarget(name)
	r.lifecycle.BeginClose(name)
	r.forgetWorkspaceReady(name)
	r.workspaceMu.Lock()
	r.workspace.RemoveWindow(name)
	r.workspaceMu.Unlock()
	r.backend.ReleaseWorkspaceWindow(name)
}

func (r *Registry) createRestoredPanelWindow(restore *namedWorkspaceRestore, state panelwindow.NamedWorkspacePanelWindow) error {
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
	if err = r.backend.RetainPanelCluster(name, group.ClusterID); err == nil {
		err = r.placeRestoredGroup(name, panelwindow.PanelLocationWindow, group)
	}
	restore.addTarget(namedWorkspaceTarget{name: name, panel: true, geometry: state.Geometry})
	var window *application.WebviewWindow
	if err == nil {
		options := r.namedWorkspaceWindowOptions(r.transferredPanelWindowOptions(name, request), state.Geometry)
		if window = r.newWindow(options); window == nil {
			err = fmt.Errorf("could not create panel window %q", name)
		}
	}
	if err != nil {
		restore.dropTarget(name)
		r.workspaceMu.Lock()
		r.panels.Remove(name)
		r.workspace.RemoveWindow(name)
		r.workspaceMu.Unlock()
		r.reportPanelLifecycleError(r.releaseNativePanelReference(name), "release panel window that could not be created")
		return err
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

// restoringWindow reports whether the workspace switch in progress created
// this window and has not yet finished with it.
func (r *Registry) restoringWindow(name string) bool {
	restore := r.activeRestore.Load()
	return restore != nil && restore.hasTarget(name)
}

func (r *Registry) AcknowledgeNamedWorkspaceRestore(name, failure string) error {
	restore := r.activeRestore.Load()
	if restore == nil || !restore.hasTarget(name) {
		return fmt.Errorf("window %q is not being restored", name)
	}
	var err error
	if failure != "" {
		err = errors.New(failure)
	}
	if !restore.answer(name, err) {
		return fmt.Errorf("window %q already acknowledged restoration", name)
	}
	return nil
}

// presentRestoredWindows puts the new workspace on screen. A window that cannot
// be shown or does not reach its saved state is reported.
func (r *Registry) presentRestoredWindows(restore *namedWorkspaceRestore) {
	for _, target := range restore.targets {
		if !r.showWindow(target.name) {
			r.reportPanelLifecycleError(fmt.Errorf("restored window %q could not be shown", target.name), "open workspace")
			continue
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
}

// closePreviousWindows takes the previous workspace off screen. Its windows
// passed their close guards in the preflight. It only detaches them from the
// registry and closes them natively; what they hold in the backend is released
// once the new windows are up (releasePreviousWindows). It returns the windows
// to release and one error for each that did not close.
func (r *Registry) closePreviousWindows(apps, panels []string) (previousWindows, []error) {
	var closed previousWindows
	var failures []error
	for _, name := range panels {
		if err := r.closePreviousPanelWindow(name); err != nil {
			failures = append(failures, err)
		}
		closed.panels = append(closed.panels, name)
	}
	for _, name := range apps {
		err := r.closePreviousAppWindow(name)
		if err != nil {
			failures = append(failures, err)
		}
		if !errors.Is(err, errReplacedWindowStaysOpen) {
			closed.apps = append(closed.apps, name)
		}
	}
	return closed, failures
}

func (r *Registry) closePreviousPanelWindow(name string) error {
	r.panelTransferMu.Lock()
	defer r.panelTransferMu.Unlock()
	if _, err := r.panels.Descriptor(name); err != nil {
		return err
	}
	closed := r.closeAuthorizedWindow(name)
	r.failPanelTabTransfersForWindow(name, "panel window closed by a workspace switch")
	r.workspaceMu.Lock()
	r.panels.Remove(name)
	r.workspaceMu.Unlock()
	if !closed {
		return fmt.Errorf("panel window %q had no native window to close", name)
	}
	return nil
}

// closePreviousAppWindow ends an app view of the previous workspace. It does
// not go through the window's own close: closing the last previous view there
// means quitting, and the saved windows are about to replace it.
func (r *Registry) closePreviousAppWindow(name string) error {
	if err := r.failClusterTransfersForWindow(name); err != nil {
		return fmt.Errorf("app window %q could not be closed: %w: %v", name, errReplacedWindowStaysOpen, err)
	}
	if _, tracked := r.lifecycle.BeginClose(name); tracked {
		r.failPanelTabTransfersForWindow(name, "app window closed by a workspace switch")
		r.declinePanelMovesInto(name)
		r.forgetWorkspaceReady(name)
	}
	if !r.closeAuthorizedWindow(name) {
		return fmt.Errorf("app window %q had no native window to close", name)
	}
	return nil
}

// releasePreviousWindows gives up what the closed windows held in the backend:
// their cluster tabs, their panel cluster references, and the panel workspaces
// of clusters the new workspace does not show.
func (r *Registry) releasePreviousWindows(previous previousWindows, replacedClusters []string) {
	for _, name := range previous.panels {
		r.reportPanelLifecycleError(r.releaseNativePanelReference(name), "release previous panel window")
	}
	for _, name := range previous.apps {
		r.backend.ReleaseWorkspaceWindow(name)
	}
	for _, cluster := range replacedClusters {
		r.releaseUnusedPanelWorkspace(cluster)
	}
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
