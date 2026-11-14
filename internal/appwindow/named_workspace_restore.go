package appwindow

import (
	"cmp"
	"context"
	"errors"
	"fmt"
	"slices"
	"sync"
	"sync/atomic"
	"time"

	"github.com/google/uuid"
	"github.com/luxury-yacht/app/internal/panelwindow"
	"github.com/wailsapp/wails/v3/pkg/application"
)

var errNamedWorkspaceOpenCancelled = errors.New("workspace switch cancelled by an open window")

// errWorkspaceSwitching refuses a new window while a switch replaces them all.
var errWorkspaceSwitching = errors.New("a workspace switch is in progress")

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
	// clusters are the clusters of the panel groups placed for this window.
	clusters []string
}

// previousWindows are windows a switch has closed, or given up on, whose
// backend holds it still has to release.
type previousWindows struct {
	apps, panels []string
	// clusters are the clusters whose panel workspaces may no longer be needed.
	clusters []string
}

// namedWorkspaceRestore is the workspace being opened: the windows the switch
// created and what could not be done for them. Nothing here can be undone, so
// it records problems for the user instead of deciding whether to go on.
type namedWorkspaceRestore struct {
	seed string
	// Previous renderers read their own layout while the replacement loads.
	previous  []string
	committed atomic.Bool
	// abandoned are saved windows that were given up: ones that could not be
	// created, and panel windows that never loaded. Their backend holds are
	// released with the previous windows', after the new ones are on screen.
	abandoned previousWindows
	// notFullscreen names the windows that did not return to fullscreen.
	notFullscreen []string
	// unrestored counts each saved window that is not on screen with its saved
	// view: it could not be created, did not load, or was gone or could not be
	// shown when the workspace was presented.
	unrestored int

	mu       sync.Mutex
	targets  []namedWorkspaceTarget
	answered map[string]bool
	// replies carries each window's answer as it arrives. loaded are the
	// windows that answered that their saved view is mounted, heard the ones
	// whose answer the switch has read, shown the ones it put on screen.
	replies chan namedWorkspaceReply
	heard   map[string]bool
	loaded  map[string]bool
	shown   map[string]bool
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

// unheard counts the windows whose answer the switch has not read yet.
func (restore *namedWorkspaceRestore) unheard() int {
	restore.mu.Lock()
	defer restore.mu.Unlock()
	waiting := 0
	for _, target := range restore.targets {
		if !restore.heard[target.name] {
			waiting++
		}
	}
	return waiting
}

// rank orders windows for a warning: one that mounted its saved view is
// listening, so it comes first; one that has not answered may still load; one
// that said it failed comes last.
func (restore *namedWorkspaceRestore) rank(name string) int {
	restore.mu.Lock()
	defer restore.mu.Unlock()
	switch {
	case restore.loaded[name]:
		return 0
	case !restore.answered[name]:
		return 1
	}
	return 2
}

func (restore *namedWorkspaceRestore) hasAnswered(window string) bool {
	restore.mu.Lock()
	defer restore.mu.Unlock()
	return restore.answered[window]
}

// hear records that the switch has read a window's answer.
func (restore *namedWorkspaceRestore) hear(reply namedWorkspaceReply) {
	restore.mu.Lock()
	defer restore.mu.Unlock()
	restore.heard[reply.window] = true
}

func (restore *namedWorkspaceRestore) isLoaded(window string) bool {
	restore.mu.Lock()
	defer restore.mu.Unlock()
	return restore.loaded[window]
}

// answer records a window's one reply. It reports false for a second one.
func (restore *namedWorkspaceRestore) answer(window string, err error) bool {
	restore.mu.Lock()
	defer restore.mu.Unlock()
	if restore.answered[window] {
		return false
	}
	restore.answered[window] = true
	restore.loaded[window] = err == nil
	// Buffered for every saved window, and each answers once.
	restore.replies <- namedWorkspaceReply{window: window, err: err}
	return true
}

// OpenNamedWorkspace closes the current windows and opens a saved arrangement
// in their place. Until the panel directory is handed over, a refusal leaves
// the current workspace as it was. The source window stays registered until a
// replacement is shown so it can be brought back if presentation fails.
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
	saved := len(snapshot.AppWindows) + len(snapshot.PanelWindows)
	if saved == 0 {
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
	// One more than the saved windows: a plain recovery window can join them,
	// and every window answers once.
	restore := &namedWorkspaceRestore{
		seed:     "workspace-restore-" + uuid.NewString(),
		previous: guard.participants,
		replies:  make(chan namedWorkspaceReply, saved+1), answered: make(map[string]bool, saved+1),
		heard: make(map[string]bool, saved+1), loaded: make(map[string]bool, saved+1), shown: make(map[string]bool, saved+1),
	}
	if err := r.beginRestore(restore, apps, panels); err != nil {
		return err
	}
	defer r.activeRestore.Store(nil)
	replacedClusters, err := r.handOverPanelDirectory(ctx, restore, snapshot)
	if err != nil {
		return err
	}
	r.createRestoredWindows(restore, snapshot)
	if len(restore.targets) == 0 {
		return r.keepPreviousWindows(restore)
	}
	previous, unclosed := r.closePreviousWindows(apps, panels, source)
	previous.clusters = replacedClusters
	r.waitForRestoredWindows(restore)
	r.settleUnloadedWindows(restore)
	r.presentRestoredWindows(restore)
	if !r.ensureWindowShown(restore) {
		return r.recoverPreviousWindow(restore, source, previous, unclosed)
	}
	restore.committed.Store(true)
	if err := r.closePreviousWindow(source, slices.Contains(panels, source), &previous); err != nil {
		unclosed = append(unclosed, err)
		if errors.Is(err, errReplacedWindowStaysOpen) {
			r.showWindow(source)
		}
	}
	r.workspace.CloseClearedWorkspace()
	// From here the user can quit. The next launch then opens the saved
	// workspace's clusters, which the switch's own claim holds, even if the
	// releases below have not finished.
	r.backend.WriteRestartSelectionOf(restore.seed)
	r.endWorkspaceReplacement(guard.transactionID)
	result := r.reportOpenedWorkspace(restore, missing, unclosed)
	// The releases can wait behind cluster connections the new workspace
	// started, so they come after its windows are on screen and usable.
	r.releasePreviousWindows(previous)
	r.releasePreviousWindows(restore.abandoned)
	// The selection is now the saved workspace's: its windows' clusters and the
	// switch's own claim on every saved cluster. Written before that claim is
	// given up, it is what the next launch opens even if every window has been
	// closed since. Giving the claim up is then an ordinary change.
	r.backend.PersistRestartSelection()
	r.backend.ReleaseWorkspaceWindow(restore.seed)
	r.quitWithoutWindows()
	return result
}

// beginRestore marks the switch active, which stops new windows (admitWindow),
// once it has confirmed that the windows which approved are still exactly the
// windows that are open. One that opened while the others were approving was
// never asked, and would outlive the switch holding the previous clusters.
func (r *Registry) beginRestore(restore *namedWorkspaceRestore, apps, panels []string) error {
	r.admissionMu.Lock()
	r.clusterCloseMu.Lock()
	// A cluster close that is under way goes on to remove its cluster's panels
	// from the directory, which the switch is about to take over.
	changed := !slices.Equal(apps, r.lifecycle.Names()) || !slices.Equal(panels, r.panels.Names("")) || len(r.clusterPanelCloses) != 0
	if !changed {
		r.activeRestore.Store(restore)
	}
	r.clusterCloseMu.Unlock()
	r.admissionMu.Unlock()
	if changed {
		return fmt.Errorf("the open windows changed while switching workspace; try again")
	}
	if r.clusterViewMoving() {
		r.activeRestore.Store(nil)
		return fmt.Errorf("a cluster view is moving between windows; try again")
	}
	return nil
}

// keepPreviousWindows ends a switch that could not create a single saved
// window. Closing the current windows would leave the app with none, so they
// stay, and their panels are put back in the directory.
func (r *Registry) keepPreviousWindows(restore *namedWorkspaceRestore) error {
	r.workspace.RestoreClearedWorkspace()
	r.releasePreviousWindows(restore.abandoned)
	r.backend.ReleaseWorkspaceWindow(restore.seed)
	r.backend.PersistRestartSelection()
	return fmt.Errorf("no window of the workspace could be created; the current windows are unchanged")
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
	// The next launch keeps opening the previous selection until the switch
	// has settled: the claims and releases on the way are not states to restart
	// into. Every way out of the switch from here ends the hold.
	r.backend.HoldRestartSelection()
	// One seed claims every saved cluster, so a cluster both workspaces show
	// stays connected and each window's own seed takes the fast path.
	if clusters := namedWorkspaceSelections(snapshot); len(clusters) != 0 {
		err = r.backend.SeedNamedWorkspaceWindow(restore.seed, clusters, "")
	}
	// A cancelled request must not go on to close the current windows.
	if err == nil {
		err = ctx.Err()
	}
	replacedClusters := r.workspace.PanelClusters()
	if err == nil {
		err = r.workspace.ClearForNamedWorkspace(revision)
	}
	if err != nil {
		// A seed that failed part-way can still have recorded its claim.
		r.backend.ReleaseWorkspaceWindow(restore.seed)
		r.backend.PersistRestartSelection()
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
	for _, target := range r.warningWindows(restore) {
		warnings.WindowName = target.name
		if r.sendWorkspaceWarnings(target, warnings) {
			return
		}
	}
	r.reportPanelLifecycleError(fmt.Errorf("no window of the new workspace could show %+v", warnings), "deliver workspace warnings")
}

// sendWorkspaceWarnings delivers to one window. An app window that has not
// mounted yet keeps the event until it has; a panel window listens once it
// has answered.
func (r *Registry) sendWorkspaceWarnings(target namedWorkspaceTarget, warnings panelwindow.NamedWorkspaceWarningsEvent) bool {
	if target.panel {
		return r.emitWindowEvent(target.name, panelwindow.NamedWorkspaceWarnings, warnings)
	}
	return r.queueWorkspaceEvent(target.name, panelwindow.NamedWorkspaceWarnings, warnings)
}

// warningWindows lists the open windows of the new workspace, the one the user
// is most likely to see the warning in first. A window whose renderer has
// answered is listening; among those, the window that entered fullscreen last
// has the display, and a window reopened minimized is not on screen at all.
func (r *Registry) warningWindows(restore *namedWorkspaceRestore) []namedWorkspaceTarget {
	var fullscreen, visible, minimized []namedWorkspaceTarget
	for _, target := range restore.targets {
		switch {
		case !restore.shown[target.name] || !r.restoredWindowOpen(target):
		case target.geometry.Minimized:
			minimized = append(minimized, target)
		case target.geometry.Fullscreen && !slices.Contains(restore.notFullscreen, target.name):
			fullscreen = append(fullscreen, target)
		default:
			visible = append(visible, target)
		}
	}
	slices.Reverse(fullscreen)
	ordered := slices.Concat(fullscreen, visible, minimized)
	ready := make(map[string]bool, len(ordered))
	for _, target := range ordered {
		ready[target.name] = r.rendererReady(target.name)
	}
	slices.SortStableFunc(ordered, func(a, b namedWorkspaceTarget) int {
		if ready[a.name] != ready[b.name] {
			if ready[a.name] {
				return -1
			}
			return 1
		}
		return cmp.Compare(restore.rank(a.name), restore.rank(b.name))
	})
	return ordered
}

func (r *Registry) restoredWindowOpen(target namedWorkspaceTarget) bool {
	if target.panel {
		_, err := r.panels.Descriptor(target.name)
		return err == nil
	}
	return r.lifecycle.Contains(target.name)
}

func (r *Registry) beginWorkspaceReplacement(source string, participants []string) (*applicationQuitPreflight, error) {
	if !slices.Contains(participants, source) || !slices.Equal(participants, r.readyWorkspaceNames()) || r.clusterViewMoving() {
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
// before they are shown. Each answers once: its view is mounted, or why it is
// not. One that can no longer answer does so with a failure
// (failRestoreOfClosedWindow), so nothing is waited for that cannot come.
func (r *Registry) waitForRestoredWindows(restore *namedWorkspaceRestore) {
	if !r.waitForRestoreReplies(restore, func() bool { return restore.unheard() == 0 }) {
		r.reportPanelLifecycleError(fmt.Errorf("%d restored windows did not finish loading", restore.unheard()), "open workspace")
	}
}

func (r *Registry) waitForRestoreReplies(restore *namedWorkspaceRestore, finished func() bool) bool {
	deadline := time.After(r.namedWorkspaceRestoreTimeout)
	for !finished() {
		select {
		case reply := <-restore.replies:
			r.hearRestoredWindow(restore, reply)
		case <-deadline:
			r.hearArrivedAnswers(restore)
			return finished()
		}
	}
	return true
}

// hearArrivedAnswers reads the answers that are already waiting: one can
// arrive together with the deadline.
func (r *Registry) hearArrivedAnswers(restore *namedWorkspaceRestore) {
	for {
		select {
		case reply := <-restore.replies:
			r.hearRestoredWindow(restore, reply)
		default:
			return
		}
	}
}

func (r *Registry) hearRestoredWindow(restore *namedWorkspaceRestore, reply namedWorkspaceReply) {
	restore.hear(reply)
	if reply.err != nil {
		r.reportPanelLifecycleError(fmt.Errorf("restore window %q: %w", reply.window, reply.err), "open workspace")
	}
}

// settleUnloadedWindows gives up the saved view of every window that did not
// mount it: it failed, could no longer answer, or had not answered by the
// deadline. A panel window is closed: it has no working close button, and it
// would keep every later save and switch waiting for it. An app window stays
// open as a plain window.
func (r *Registry) settleUnloadedWindows(restore *namedWorkspaceRestore) {
	for _, target := range slices.Clone(restore.targets) {
		if restore.isLoaded(target.name) {
			continue
		}
		restore.unrestored++
		switch {
		case target.panel:
			r.abandonRestoredPanelWindow(restore, target)
		case restore.hasAnswered(target.name) || !r.rendererReady(target.name):
			r.giveUpRestoredAppView(restore, target)
		}
		// An app window that is alive and still working on its view keeps what
		// was set up for it, and finishes late.
	}
}

// giveUpRestoredAppView takes back what the switch set up for an app window
// that did not mount its saved view. Its docked panels leave the directory:
// the window does not show them, and left there they could not be opened
// anywhere else. Its restore request is withdrawn, so a page that loads late
// is a plain window and is not told to apply a view the switch gave up on.
func (r *Registry) giveUpRestoredAppView(restore *namedWorkspaceRestore, target namedWorkspaceTarget) {
	r.withdrawQueuedWorkspaceEvent(target.name, panelwindow.NamedWorkspaceRestoreRequested)
	r.workspaceMu.Lock()
	r.workspace.RemoveWindow(target.name)
	r.workspaceMu.Unlock()
	restore.abandoned.clusters = append(restore.abandoned.clusters, target.clusters...)
}

// failRestoreOfClosedWindow answers for a saved window that can no longer
// answer for itself: it closed (closeAuthorizedWindow and handleClosing cover
// every close), or its renderer went after announcing (WithdrawRendererReady).
// A window that has answered already is not answered for again.
func (r *Registry) failRestoreOfClosedWindow(name string) {
	if restore := r.activeRestore.Load(); restore != nil && restore.hasTarget(name) {
		restore.answer(name, errors.New("the window closed or stopped responding before it had loaded"))
	}
}

// dropRestoredPanelPlacement removes what the switch placed for a saved panel
// window that failed to start, and the hold on its cluster's panel workspace
// if nothing else needs it.
func (r *Registry) dropRestoredPanelPlacement(name, cluster string) {
	r.workspaceMu.Lock()
	r.workspace.RemoveWindow(name)
	r.workspaceMu.Unlock()
	r.releaseUnusedPanelWorkspace(cluster)
}

// ensureWindowShown tries one plain window if no usable saved window made it
// on screen. The plain window needs a working renderer before it can take over.
func (r *Registry) ensureWindowShown(restore *namedWorkspaceRestore) bool {
	if slices.ContainsFunc(restore.targets, func(target namedWorkspaceTarget) bool {
		return restore.shown[target.name] && r.restoredWindowOpen(target) && r.canUseRestoredWindow(restore, target)
	}) {
		return true
	}
	if err := r.createRestoredAppWindow(restore, panelwindow.NamedWorkspaceAppWindow{}); err != nil {
		r.reportPanelLifecycleError(err, "open a window after no saved window could be restored")
		return false
	}
	target := restore.targets[len(restore.targets)-1]
	if !r.waitForRestoreReplies(restore, func() bool { return restore.hasAnswered(target.name) }) {
		r.reportPanelLifecycleError(fmt.Errorf("recovery window %q did not finish loading", target.name), "open workspace")
		return false
	}
	r.hearArrivedAnswers(restore)
	return restore.isLoaded(target.name) && r.showRestoredWindow(restore, target) &&
		r.restoredWindowOpen(target) && r.rendererReady(target.name)
}

func (r *Registry) canUseRestoredWindow(restore *namedWorkspaceRestore, target namedWorkspaceTarget) bool {
	if target.panel {
		return restore.isLoaded(target.name)
	}
	return r.rendererReady(target.name)
}

// abandonRestoredPanelWindow removes a saved panel window that could not be
// created or did not load. What it holds in the backend is released later.
func (r *Registry) abandonRestoredPanelWindow(restore *namedWorkspaceRestore, target namedWorkspaceTarget) {
	restore.dropTarget(target.name)
	r.panelTransferMu.Lock()
	r.closeAuthorizedWindow(target.name)
	r.workspaceMu.Lock()
	r.panels.Remove(target.name)
	r.workspace.RemoveWindow(target.name)
	r.workspaceMu.Unlock()
	r.panelTransferMu.Unlock()
	restore.abandoned.panels = append(restore.abandoned.panels, target.name)
	restore.abandoned.clusters = append(restore.abandoned.clusters, target.clusters...)
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
	return r.workspace.PlaceNamedWorkspaceGroup(window, kind, group)
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
	target := namedWorkspaceTarget{name: name, geometry: state.Geometry}
	for _, dock := range state.DockedGroups {
		target.clusters = append(target.clusters, dock.Group.ClusterID)
	}
	restore.addTarget(target)
	var window *application.WebviewWindow
	if err == nil {
		if window = r.newWindow(r.namedWorkspaceWindowOptions(windowOptions(name), state.Geometry)); window == nil {
			err = fmt.Errorf("could not create app window %q", name)
		}
	}
	if err != nil {
		r.abandonRestoredAppWindow(restore, target)
		return err
	}
	r.registerLifecycleHooks(window, name, false)
	return nil
}

// abandonRestoredAppWindow gives up a saved app window that could not be
// created. What it holds in the backend is released later.
func (r *Registry) abandonRestoredAppWindow(restore *namedWorkspaceRestore, target namedWorkspaceTarget) {
	restore.dropTarget(target.name)
	r.lifecycle.BeginClose(target.name)
	r.forgetWorkspaceReady(target.name)
	r.workspaceMu.Lock()
	r.workspace.RemoveWindow(target.name)
	r.workspaceMu.Unlock()
	restore.abandoned.apps = append(restore.abandoned.apps, target.name)
	restore.abandoned.clusters = append(restore.abandoned.clusters, target.clusters...)
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
	target := namedWorkspaceTarget{name: name, panel: true, geometry: state.Geometry, clusters: []string{group.ClusterID}}
	restore.addTarget(target)
	var window *application.WebviewWindow
	if err == nil {
		options := r.namedWorkspaceWindowOptions(r.transferredPanelWindowOptions(name, request), state.Geometry)
		if window = r.newWindow(options); window == nil {
			err = fmt.Errorf("could not create panel window %q", name)
		}
	}
	if err != nil {
		r.abandonRestoredPanelWindow(restore, target)
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

func (r *Registry) unpublishedRestoredWindow(name string) bool {
	restore := r.activeRestore.Load()
	return restore != nil && !restore.committed.Load() && restore.hasTarget(name)
}

// AcknowledgeNamedWorkspaceRestore is a saved window's one answer: its view is
// mounted, or why it is not. An answer that comes after the switch stopped
// waiting for that window is ignored: the switch has already settled what the
// window shows.
func (r *Registry) AcknowledgeNamedWorkspaceRestore(name, failure string) error {
	restore := r.activeRestore.Load()
	if restore == nil || !restore.hasTarget(name) {
		return nil
	}
	var err error
	if failure != "" {
		err = errors.New(failure)
	}
	restore.answer(name, err)
	return nil
}

// presentRestoredWindows puts the new workspace on screen. A window that
// loaded but has gone since, or cannot be shown, is counted; one that does not
// reach its saved state is reported.
func (r *Registry) presentRestoredWindows(restore *namedWorkspaceRestore) {
	for _, target := range restore.targets {
		if !r.showRestoredWindow(restore, target) {
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
		if target.geometry.Fullscreen && restore.shown[target.name] && !r.restoreWindowState(target.name, target.geometry) {
			restore.notFullscreen = append(restore.notFullscreen, target.name)
		}
	}
}

// closePreviousWindows takes the previous workspace off screen. The source
// stays registered with its backend holds so it can show a failed switch.
func (r *Registry) closePreviousWindows(apps, panels []string, source string) (previousWindows, []error) {
	var closed previousWindows
	var failures []error
	for _, name := range panels {
		if name == source {
			continue
		}
		if err := r.closePreviousWindow(name, true, &closed); err != nil {
			failures = append(failures, err)
		}
	}
	for _, name := range apps {
		if name == source {
			continue
		}
		if err := r.closePreviousWindow(name, false, &closed); err != nil {
			failures = append(failures, err)
		}
	}
	r.hideWindow(source)
	return closed, failures
}

func (r *Registry) closePreviousWindow(name string, panel bool, closed *previousWindows) error {
	if panel {
		err := r.closePreviousPanelWindow(name)
		closed.panels = append(closed.panels, name)
		return err
	}
	err := r.closePreviousAppWindow(name)
	if !errors.Is(err, errReplacedWindowStaysOpen) {
		closed.apps = append(closed.apps, name)
	}
	return err
}

// recoverPreviousWindow brings the source back and retires the failed
// replacements. Drop the temporary cluster claim before persisting the
// remaining windows' selection.
func (r *Registry) recoverPreviousWindow(restore *namedWorkspaceRestore, source string, previous previousWindows, failures []error) error {
	for _, target := range slices.Clone(restore.targets) {
		if target.panel {
			r.abandonRestoredPanelWindow(restore, target)
		} else {
			r.abandonRestoredAppWindow(restore, target)
			r.closeAuthorizedWindow(target.name)
		}
	}
	r.workspace.RestoreClearedWorkspace(slices.Concat(previous.apps, previous.panels)...)
	for _, cluster := range previous.clusters {
		r.emitWorkspaceChanged(cluster)
	}
	if !r.showWindow(source) {
		failures = append(failures, fmt.Errorf("could not show the previous window %q", source))
	}
	r.releasePreviousWindows(previous)
	r.releasePreviousWindows(restore.abandoned)
	r.backend.ReleaseWorkspaceWindow(restore.seed)
	r.backend.PersistRestartSelection()
	return errors.Join(append([]error{errors.New("no replacement window could be shown")}, failures...)...)
}

func (r *Registry) closePreviousPanelWindow(name string) error {
	r.panelTransferMu.Lock()
	defer r.panelTransferMu.Unlock()
	if _, err := r.panels.Descriptor(name); err != nil {
		// It closed on its own since it approved, as when its cluster was removed.
		return nil
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
func (r *Registry) releasePreviousWindows(previous previousWindows) {
	for _, name := range previous.panels {
		r.reportPanelLifecycleError(r.releaseNativePanelReference(name), "release closed panel window")
	}
	for _, name := range previous.apps {
		r.backend.ReleaseWorkspaceWindow(name)
	}
	for _, cluster := range previous.clusters {
		r.releaseUnusedPanelWorkspace(cluster)
	}
}

// showRestoredWindow shows one window of the new workspace and reports whether
// it is on screen.
func (r *Registry) showRestoredWindow(restore *namedWorkspaceRestore, target namedWorkspaceTarget) bool {
	if r.restoredWindowOpen(target) && r.showWindow(target.name) {
		restore.shown[target.name] = true
		return true
	}
	// One that did not load was counted when it was settled.
	if restore.isLoaded(target.name) {
		restore.unrestored++
		r.reportPanelLifecycleError(fmt.Errorf("restored window %q could not be shown", target.name), "open workspace")
	}
	return false
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
