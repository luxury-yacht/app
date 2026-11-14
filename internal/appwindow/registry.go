package appwindow

import (
	"context"
	"errors"
	"fmt"
	"runtime"
	"slices"
	"sync"
	"sync/atomic"
	"time"

	"github.com/luxury-yacht/app/internal/panelwindow"
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

type lifecycleBackend interface {
	CloseClusterView(string, string) error
	WindowRuntimeReady(windowName string, restoreGeometry bool) bool
	ReleaseWorkspaceWindow(windowID string)
	PrepareQuitFromWindow(windowName string) bool
	SaveWorkspaceWindowGeometry(string)
	WindowClusterIDs(string) []string
	PersistRestartSelection()
	HoldRestartSelection()
	NamedWorkspaceAvailableClusters() ([]string, error)
	SeedNamedWorkspaceWindow(string, []string, string) error
	WriteRestartSelectionOf(string)
	ResolveNamedWorkspaceGeometry(panelwindow.NamedWorkspaceGeometry) (panelwindow.WindowBounds, bool)
	panelwindow.ClusterViewTransferLifecycle
	PanelWorkspaceDirectory() *panelwindow.WorkspaceDirectory
	RetainPanelCluster(string, string) error
	ReleasePanelCluster(string) error
}

// Registry owns the application's peer workspace windows and their lifecycle.
type Registry struct {
	namedWorkspaceOperation sync.Mutex
	// admissionMu orders new windows against a workspace switch. See admitWindow.
	admissionMu            sync.Mutex
	workspaceCaptureMu     sync.Mutex
	workspaceCapture       *namedWorkspaceCapture
	normalWorkspaceBounds  sync.Map
	clusterCloseMu         sync.Mutex
	nextClusterClose       uint64
	clusterPanelCloses     map[string]*clusterPanelClose
	clusterTransfers       transferLifecycle[clusterViewTransfer]
	application            *application.App
	backend                lifecycleBackend
	lifecycle              *lifecycle
	panels                 *panelIndex
	workspace              *panelwindow.WorkspaceDirectory
	workspaceMu            sync.Mutex
	clusterTransferMu      sync.Mutex
	newWindow              func(application.WebviewWindowOptions) *application.WebviewWindow
	configurePanelWindow   func(*application.WebviewWindow)
	showWindow             func(string) bool
	hideWindow             func(string) bool
	closeWindow            func(string) bool
	requestApplicationQuit func()
	focusWindow            func(string) bool
	emitWindowEvent        func(string, string, any) bool
	windowGeometry         func(string) (geometry, bool)
	restoreWindowState     func(string, panelwindow.NamedWorkspaceGeometry) bool
	// activeRestore is the workspace switch in progress: the windows it created
	// and their answers.
	activeRestore                atomic.Pointer[namedWorkspaceRestore]
	namedWorkspaceRestoreTimeout time.Duration
	screenWorkAreas              func() []application.Rect
	closeMu                      sync.Mutex
	authorizedClose              map[string]struct{}
	panelWorkspaceReady          map[string]struct{}
	// rendererPage is the highest page number each window's renderer has sent
	// with a readiness call. See enterRendererPage.
	rendererPage           map[string]int64
	queuedWorkspaceEvents  map[string][]workspaceWindowEvent
	panelOpenTimeout       time.Duration
	panelDockTimeout       time.Duration
	clusterTransferTimeout time.Duration
	clusterCloseTimeout    time.Duration
	quitMu                 sync.Mutex
	nextQuit               uint64
	pendingQuit            *applicationQuitPreflight
	quitPreflightTimeout   time.Duration
	panelTransferMu        sync.Mutex
	tabTransferMu          sync.Mutex
	tabTransfers           transferLifecycle[panelTabTransfer]
	tabTransferTimeout     time.Duration
}

type applicationQuitPreflight struct {
	transactionID string
	participants  []string
	waiting       map[string]struct{}
	timeout       *time.Timer
	replacement   chan error
}

type geometry struct {
	AbsoluteX  int
	AbsoluteY  int
	X          int
	Y          int
	Width      int
	Height     int
	Maximised  bool
	Fullscreen bool
	Minimised  bool
	Screen     *application.Screen
}

// normal reports whether the bounds are the window's own, not those of a
// maximized, fullscreen, or minimized state.
func (g geometry) normal() bool {
	return !g.Maximised && !g.Fullscreen && !g.Minimised
}

const cascadeOffset = 24

// The smallest size each kind of window can have. Saved bounds are never
// smaller, whatever a window reported when it was captured.
const (
	appWindowMinWidth    = 1100
	appWindowMinHeight   = 600
	panelWindowMinWidth  = 450
	panelWindowMinHeight = 200
)

func showApplicationWindow(app *application.App, name string) bool {
	window, ok := app.Window.GetByName(name)
	if !ok {
		return false
	}
	window.Show()
	return true
}

func hideApplicationWindow(app *application.App, name string) bool {
	window, ok := app.Window.GetByName(name)
	if !ok {
		return false
	}
	window.Hide()
	return true
}

func closeApplicationWindow(app *application.App, name string) bool {
	window, ok := app.Window.GetByName(name)
	if !ok {
		return false
	}
	window.Close()
	return true
}

func focusApplicationWindow(app *application.App, name string) bool {
	window, ok := app.Window.GetByName(name)
	if !ok {
		return false
	}
	window.Show()
	if window.IsMinimised() {
		window.Restore()
	}
	window.Focus()
	return true
}

func emitApplicationWindowEvent(
	app *application.App,
	windowName, eventName string,
	payload any,
) bool {
	window, ok := app.Window.GetByName(windowName)
	if !ok {
		return false
	}
	// Wails reports whether an event was cancelled, while registry callers
	// need to know whether delivery was accepted.
	return !window.EmitEvent(eventName, payload)
}

func applicationWindowGeometry(app *application.App, name string) (geometry, bool) {
	window, ok := app.Window.GetByName(name)
	if !ok {
		return geometry{}, false
	}
	width, height := window.Size()
	if width <= 0 || height <= 0 {
		return geometry{}, false
	}
	result := geometry{
		Width:      width,
		Height:     height,
		Maximised:  window.IsMaximised(),
		Fullscreen: window.IsFullscreen(),
		Minimised:  window.IsMinimised(),
	}
	result.AbsoluteX, result.AbsoluteY = window.Position()
	if screen, err := window.GetScreen(); err == nil && screen != nil {
		result.X, result.Y = window.RelativePosition()
		result.Screen = screen
	}
	return result, true
}

func bindApplicationWindowOperations(registry *Registry, app *application.App) {
	registry.requestApplicationQuit = app.Quit
	registry.newWindow = func(options application.WebviewWindowOptions) *application.WebviewWindow {
		window := app.Window.NewWithOptions(options)
		if nativeInspectorEnabled {
			window.OnWindowEvent(events.Common.WindowRuntimeReady, func(*application.WindowEvent) {
				configureNativeInspector(window)
			})
		}
		return window
	}
	registry.showWindow = func(name string) bool {
		return showApplicationWindow(app, name)
	}
	registry.hideWindow = func(name string) bool {
		return hideApplicationWindow(app, name)
	}
	registry.closeWindow = func(name string) bool {
		return closeApplicationWindow(app, name)
	}
	registry.focusWindow = func(name string) bool {
		return focusApplicationWindow(app, name)
	}
	registry.emitWindowEvent = func(windowName, eventName string, payload any) bool {
		return emitApplicationWindowEvent(app, windowName, eventName, payload)
	}
	registry.windowGeometry = func(name string) (geometry, bool) {
		return applicationWindowGeometry(app, name)
	}
	registry.restoreWindowState = func(name string, state panelwindow.NamedWorkspaceGeometry) bool {
		return restoreApplicationWindowState(app, name, state)
	}
}

// How long a window gets to finish entering fullscreen before the next one starts.
const fullscreenTransitionTimeout = 3 * time.Second

// fullscreenAnnouncement is the event a platform sends once a window has
// entered fullscreen. Windows enters synchronously and needs no wait.
func fullscreenAnnouncement(goos string) (events.WindowEventType, bool) {
	switch goos {
	case "darwin":
		return events.Mac.WindowDidEnterFullScreen, true
	case "linux":
		return events.Common.WindowFullscreen, true
	}
	return 0, false
}

// enterFullscreenOn puts a window into fullscreen and reports whether it got
// there. Where the platform enters asynchronously it waits for the transition
// to finish: macOS runs one fullscreen transition at a time and drops a request
// made while another is running, so windows must enter in turn.
func enterFullscreenOn(goos string, window application.Window, timeout time.Duration) bool {
	announcement, waits := fullscreenAnnouncement(goos)
	if !waits {
		window.Fullscreen()
		return window.IsFullscreen()
	}
	entered := make(chan struct{}, 1)
	stop := window.OnWindowEvent(announcement, func(*application.WindowEvent) {
		select {
		case entered <- struct{}{}:
		default:
		}
	})
	defer stop()
	window.Fullscreen()
	select {
	case <-entered:
		return true
	case <-time.After(timeout):
		// The announcement can be missed; the window's own state decides.
		return window.IsFullscreen()
	}
}

// restoreApplicationWindowState puts a window back into the state it was saved
// in. Minimise comes last so a maximized window that was minimized returns to
// its maximized size when it is brought back.
func restoreApplicationWindowState(app *application.App, name string, state panelwindow.NamedWorkspaceGeometry) bool {
	window, ok := app.Window.GetByName(name)
	if !ok {
		return false
	}
	restored := true
	if state.Maximized {
		window.Maximise()
	}
	if state.Fullscreen {
		restored = enterFullscreenOn(runtime.GOOS, window, fullscreenTransitionTimeout)
	}
	if state.Maximized || state.Fullscreen {
		// Wails drops the minimum size to enter either state and puts it back only
		// through its own exit, which the title bar and window manager never call.
		// These windows have no maximum size for the minimum to conflict with.
		window.EnableSizeConstraints()
	}
	if state.Minimized {
		window.Minimise()
	}
	return restored
}

// NewRegistry creates the peer-window registry for a Wails application.
func NewRegistry(
	app *application.App,
	backend lifecycleBackend,
) *Registry {
	configureNativeTabDragAnimation()
	registry := &Registry{
		application:                  app,
		backend:                      backend,
		lifecycle:                    newLifecycle(),
		panels:                       newPanelIndex(),
		workspace:                    panelwindow.NewWorkspaceDirectory(),
		authorizedClose:              make(map[string]struct{}),
		panelOpenTimeout:             15 * time.Second,
		panelDockTimeout:             15 * time.Second,
		clusterTransferTimeout:       15 * time.Second,
		clusterCloseTimeout:          15 * time.Second,
		quitPreflightTimeout:         20 * time.Second,
		namedWorkspaceRestoreTimeout: defaultNamedWorkspaceRestoreTimeout,
		tabTransferTimeout:           15 * time.Second,
		configurePanelWindow:         configureNativePanelWindow,
	}
	if backend != nil {
		registry.workspace = backend.PanelWorkspaceDirectory()
		registry.workspace.SetClusterRemovalHandler(registry.clusterRemoved)
	}
	bindApplicationWindowOperations(registry, app)
	registry.screenWorkAreas = func() []application.Rect {
		if app == nil || app.Screen == nil {
			return nil
		}
		screens := app.Screen.GetAll()
		areas := make([]application.Rect, 0, len(screens))
		for _, screen := range screens {
			if screen != nil {
				areas = append(areas, screen.WorkArea)
			}
		}
		return areas
	}
	return registry
}

// BeginPanelWindowOpen records a pending handoff and creates its hidden native
// target. The caller keeps rendering the source until the transfer is acknowledged.
func (r *Registry) BeginPanelWindowOpen(
	snapshot PanelGroupSnapshot,
) (PanelWindowDescriptor, error) {
	if r == nil || !r.windowHasCluster(snapshot.SourceWindowName, snapshot.ClusterID) {
		return PanelWindowDescriptor{}, fmt.Errorf(
			"source window %q is not live",
			snapshot.SourceWindowName,
		)
	}
	if err := ValidatePanelGroupSnapshot(snapshot); err != nil {
		return PanelWindowDescriptor{}, err
	}
	reservation := r.workspace.ReserveCluster(snapshot.ClusterID)
	defer r.releasePanelReservation(reservation, snapshot.ClusterID)
	if err := r.retainPanelWorkspace(snapshot.ClusterID); err != nil {
		return PanelWindowDescriptor{}, err
	}
	r.panelTransferMu.Lock()
	descriptor, err := r.beginPanelWindowOpenTransfer(snapshot, reservation)
	r.panelTransferMu.Unlock()
	if err != nil {
		return PanelWindowDescriptor{}, err
	}
	if err := r.backend.RetainPanelCluster(descriptor.WindowName, snapshot.ClusterID); err != nil {
		_ = r.panels.FailTransfer(descriptor.WindowName, snapshot.TransferID)
		return PanelWindowDescriptor{}, err
	}
	if err := r.createRetainedPanelWindow(descriptor, snapshot, reservation); err != nil {
		_ = r.panels.FailTransfer(descriptor.WindowName, snapshot.TransferID)
		return PanelWindowDescriptor{}, errors.Join(err, r.releaseNativePanelReference(descriptor.WindowName))
	}
	return r.withPanelGroup(descriptor), nil
}

// Backend retention may wait behind a connection. Revalidate cluster admission
// after that wait (the directory already holds the group's panels in place), then
// serialize native creation with cancellation and readiness.
func (r *Registry) createRetainedPanelWindow(descriptor PanelWindowDescriptor, snapshot PanelGroupSnapshot, reservation *panelwindow.WorkspaceReservation) error {
	r.panelTransferMu.Lock()
	defer r.panelTransferMu.Unlock()
	pending, err := r.panels.Descriptor(descriptor.WindowName)
	if err != nil || pending.State != PanelWindowStateOpening {
		return fmt.Errorf("panel open is no longer pending")
	}
	r.workspaceMu.Lock()
	valid := reservation.Live() && r.windowHasCluster(snapshot.SourceWindowName, snapshot.ClusterID)
	r.workspaceMu.Unlock()
	if !valid {
		return fmt.Errorf("panel source changed during open")
	}
	options := r.transferredPanelWindowOptions(descriptor.WindowName, snapshot)
	window := r.newWindow(options)
	if window == nil {
		_ = r.panels.FailTransfer(descriptor.WindowName, snapshot.TransferID)
		r.failPanelTabTransfer(snapshot.TransferID, "new panel target could not be created")
		return fmt.Errorf("create native panel window %q", descriptor.WindowName)
	}
	if r.configurePanelWindow != nil {
		r.configurePanelWindow(window)
	}
	r.registerPanelLifecycleHooks(window, descriptor.WindowName)
	r.panels.setTransferTimeout(descriptor.WindowName, snapshot.TransferID, r.panelOpenTimeout, func() {
		r.expirePanelOpen(descriptor.WindowName, snapshot.TransferID)
	})
	return nil
}

func (r *Registry) positionWindowAtTransferredBounds(
	options *application.WebviewWindowOptions,
	bounds panelwindow.WindowBounds,
	anchor *panelwindow.WindowPoint,
) bool {
	if options == nil {
		return false
	}
	// Transferred bounds are absolute, not relative to the source screen.
	options.Screen = nil
	options.InitialPosition = application.WindowXY
	options.X = bounds.X
	options.Y = bounds.Y
	if r.screenWorkAreas == nil {
		return true
	}
	anchorX, anchorY := bounds.X, bounds.Y
	if anchor != nil {
		anchorX, anchorY = anchor.X, anchor.Y
	}
	for _, area := range r.screenWorkAreas() {
		if anchorX < area.X || anchorY < area.Y ||
			anchorX >= area.X+area.Width || anchorY >= area.Y+area.Height {
			continue
		}
		constrainWindowOptions(options, area)
		return true
	}
	return true
}

func (r *Registry) expirePanelOpen(windowName, transferID string) {
	if r.panels.State(windowName) != PanelWindowStateOpening {
		return
	}
	_ = r.FailPanelWindowTransfer(windowName, windowName, transferID)
}

// Create adds a peer window. Only the initial peer restores persisted geometry.
func (r *Registry) Create(restoreGeometry bool) *application.WebviewWindow {
	window, _ := r.create(restoreGeometry)
	return window
}

func (r *Registry) CreateWorkspaceWindow() error {
	_, err := r.create(false)
	return err
}

func (r *Registry) create(restoreGeometry bool) (*application.WebviewWindow, error) {
	// A new peer takes the process's cluster selection, which a workspace switch
	// is in the middle of replacing.
	var sourceName, name string
	if !r.admitWindow(func() {
		sourceName = r.lifecycle.MostRecent()
		name = r.lifecycle.Add()
	}) {
		return nil, panelwindow.ErrWorkspaceSwitching
	}
	window := r.newWindow(r.optionsForPeer(name, sourceName, restoreGeometry))
	if window == nil {
		r.lifecycle.BeginClose(name)
		return nil, fmt.Errorf("could not create app window %q", name)
	}
	r.registerLifecycleHooks(window, name, restoreGeometry)
	return window, nil
}

// admitWindow registers a new window by running add, unless a workspace switch
// is replacing the windows. The switch takes the same lock to confirm which
// windows exist before it closes them, so a window is either one it saw or one
// it refused.
func (r *Registry) admitWindow(add func()) bool {
	r.admissionMu.Lock()
	defer r.admissionMu.Unlock()
	if r.activeRestore.Load() != nil {
		return false
	}
	add()
	return true
}

func (r *Registry) optionsForPeer(name, sourceName string, restoreGeometry bool) application.WebviewWindowOptions {
	options := windowOptions(name)
	if restoreGeometry || sourceName == "" {
		return options
	}
	sourceGeometry, ok := r.windowGeometry(sourceName)
	if !ok {
		return options
	}
	options.Width = sourceGeometry.Width
	options.Height = sourceGeometry.Height
	applyPeerPosition(&options, sourceGeometry)
	if sourceGeometry.Maximised {
		options.StartState = application.WindowStateMaximised
	}
	return options
}

func applyPeerPosition(options *application.WebviewWindowOptions, sourceGeometry geometry) {
	if sourceGeometry.Screen == nil {
		return
	}
	options.InitialPosition = application.WindowXY
	options.X = cascadedCoordinate(
		sourceGeometry.X,
		sourceGeometry.Width,
		sourceGeometry.Screen.WorkArea.Width,
	)
	options.Y = cascadedCoordinate(
		sourceGeometry.Y,
		sourceGeometry.Height,
		sourceGeometry.Screen.WorkArea.Height,
	)
	options.Screen = sourceGeometry.Screen
}

func (r *Registry) registerLifecycleHooks(
	window *application.WebviewWindow,
	name string,
	restoreGeometry bool,
) {
	r.trackNamedWorkspaceBounds(window, name)
	window.OnWindowEvent(events.Common.WindowRuntimeReady, func(*application.WindowEvent) {
		// The backend shows a window once its runtime is ready. A window a
		// workspace switch is restoring is shown by the switch, once it has loaded.
		if !r.restoringWindow(name) {
			r.backend.WindowRuntimeReady(name, restoreGeometry)
		}
		r.rememberNamedWorkspaceBounds(name)
	})
	window.OnWindowEvent(events.Common.WindowFocus, func(*application.WindowEvent) {
		r.lifecycle.Focus(name)
	})
	window.RegisterHook(events.Common.WindowClosing, func(event *application.WindowEvent) {
		r.handleClosing(event, name)
	})
}

func (r *Registry) registerPanelLifecycleHooks(
	window *application.WebviewWindow,
	name string,
) {
	r.trackNamedWorkspaceBounds(window, name)
	window.OnWindowEvent(events.Common.WindowRuntimeReady, func(*application.WindowEvent) {
		r.rememberNamedWorkspaceBounds(name)
	})
	window.RegisterHook(events.Common.WindowClosing, func(event *application.WindowEvent) {
		r.handlePanelClosingEvent(event, name)
	})
}

func (r *Registry) authorizeClose(name string) {
	r.closeMu.Lock()
	defer r.closeMu.Unlock()
	if r.authorizedClose == nil {
		r.authorizedClose = make(map[string]struct{})
	}
	r.authorizedClose[name] = struct{}{}
}

// The native close hook can consume authorization synchronously. If no window
// accepts the close, discard the unused authorization before returning.
func (r *Registry) closeAuthorizedWindow(name string) bool {
	r.failCaptureOfClosedWindow(name)
	r.failRestoreOfClosedWindow(name)
	r.authorizeClose(name)
	if r.closeWindow(name) {
		r.normalWorkspaceBounds.Delete(name)
		return true
	}
	r.consumeAuthorizedClose(name)
	return false
}

func (r *Registry) consumeAuthorizedClose(name string) bool {
	r.closeMu.Lock()
	defer r.closeMu.Unlock()
	if _, ok := r.authorizedClose[name]; !ok {
		return false
	}
	delete(r.authorizedClose, name)
	return true
}

func (r *Registry) forgetWorkspaceReady(name string) {
	r.closeMu.Lock()
	defer r.closeMu.Unlock()
	delete(r.panelWorkspaceReady, name)
	delete(r.rendererPage, name)
	delete(r.queuedWorkspaceEvents, name)
}

func (r *Registry) handlePanelClosingEvent(event *application.WindowEvent, name string) {
	if r.consumeAuthorizedClose(name) {
		return
	}
	_, err := r.panels.Descriptor(name)
	if err != nil {
		return
	}
	if event != nil {
		event.Cancel()
	}
	// A workspace switch is about to close this window itself.
	if r.switchParticipant(name) {
		return
	}
	// A live window whose renderer cannot answer has no close guard to run.
	// It is closed the way its renderer would close it after approving.
	if r.panels.State(name) == PanelWindowStateLive && !r.rendererReady(name) {
		r.reportPanelLifecycleError(r.AcknowledgePanelWindowClose(name), "close a panel window whose renderer cannot answer")
		return
	}
	r.emitWindowEvent(name, panelwindow.WindowCloseRequestedEventName, panelwindow.WindowCloseRequestedEvent{
		WindowName: name,
		Reason:     "titlebar",
	})
}

// PanelDescriptor returns the immutable identity and current transfer state of
// a live native panel window.
func (r *Registry) PanelDescriptor(name string) (PanelWindowDescriptor, error) {
	if r == nil || r.panels == nil {
		return PanelWindowDescriptor{}, fmt.Errorf("panel window %q is not live", name)
	}
	descriptor, err := r.panels.Descriptor(name)
	if err != nil {
		return PanelWindowDescriptor{}, err
	}
	return r.withPanelGroup(descriptor), nil
}

// WindowDescriptor resolves the native role associated with a Wails window
// name without relying on URL or caller-provided role state.
func (r *Registry) WindowDescriptor(name string) (NativeWindowDescriptor, error) {
	if r != nil && r.lifecycle != nil && r.lifecycle.Contains(name) {
		return NativeWindowDescriptor{
			SchemaVersion: NativeWindowDescriptorSchemaVersion,
			Role:          NativeWindowRoleWorkspace,
			Workspace:     &WorkspaceWindowDescriptor{WindowName: name},
		}, nil
	}
	if r != nil && r.panels != nil {
		panel, err := r.panels.Descriptor(name)
		if err == nil {
			panel = r.withPanelGroup(panel)
			return NativeWindowDescriptor{
				SchemaVersion: NativeWindowDescriptorSchemaVersion,
				Role:          NativeWindowRolePanel,
				Panel:         &panel,
			}, nil
		}
	}
	return NativeWindowDescriptor{}, fmt.Errorf("native window %q is not registered", name)
}

// AcknowledgePanelWindowReady reveals the hidden native target, then commits the
// directory move. A stale acknowledgement leaves the source transfer pending.
func (r *Registry) AcknowledgePanelWindowReady(name, transferID string) (PanelWindowDescriptor, error) {
	// A panel window that reloads is already live, so it has no transfer to
	// name. It boots from its descriptor and announces readiness afterwards.
	if transferID == "" {
		if r.panels.State(name) != PanelWindowStateLive {
			return PanelWindowDescriptor{}, fmt.Errorf("panel window %q is not live", name)
		}
		return r.PanelDescriptor(name)
	}
	// A panel window a workspace switch is restoring has no source to move
	// from: its tabs are already placed, and the switch shows it.
	if r.restoringWindow(name) {
		descriptor, err := r.panels.AcknowledgeOpen(name, transferID)
		if err != nil {
			return PanelWindowDescriptor{}, err
		}
		return r.withPanelGroup(descriptor), r.AcknowledgeNamedWorkspaceRestore(name, "")
	}
	r.panelTransferMu.Lock()
	defer r.panelTransferMu.Unlock()
	descriptor, err := r.panels.Pending(name, transferID, PanelWindowStateOpening)
	if err != nil {
		return PanelWindowDescriptor{}, err
	}
	source := r.panels.OpeningSource(name)
	if err := r.commitReadyPanelPlacement(descriptor); err != nil {
		return PanelWindowDescriptor{}, errors.Join(err, r.abortReadyPanelWindow(descriptor))
	}
	if descriptor, err = r.panels.AcknowledgeOpen(name, transferID); err != nil {
		return PanelWindowDescriptor{}, err
	}
	descriptor = r.withPanelGroup(descriptor)
	r.emitWindowEvent(source, panelwindow.WindowOpenedEventName, panelwindow.WindowOpenedEvent{
		WindowName: name, TransferID: transferID, SourceWindowName: source, ClusterID: descriptor.ClusterID, GroupID: descriptor.GroupID, Tabs: descriptor.Group.Tabs,
	})
	r.completePanelTabTransferForOpenedWindow(transferID)
	r.emitWorkspaceChanged(descriptor.ClusterID)
	return descriptor, nil
}

// withPanelGroup adds the directory's placement for a native window: the tabs
// it holds, or while it opens, the tabs moving into it.
func (r *Registry) withPanelGroup(descriptor PanelWindowDescriptor) PanelWindowDescriptor {
	opening := ""
	if descriptor.State == PanelWindowStateOpening {
		opening = descriptor.TransferID
	}
	descriptor.Group = r.workspace.WindowGroup(descriptor.ClusterID, descriptor.WindowName, descriptor.GroupID, opening)
	return descriptor
}

// Placement moves only after the native side effect succeeded, so a failure
// needs no rollback: aborting the native transfer cancels the directory move.
func (r *Registry) commitReadyPanelPlacement(descriptor PanelWindowDescriptor) error {
	if !r.showWindow(descriptor.WindowName) {
		return fmt.Errorf("panel window %q disappeared before ready", descriptor.WindowName)
	}
	r.workspaceMu.Lock()
	defer r.workspaceMu.Unlock()
	return r.workspace.CommitGroupTransfer(descriptor.TransferID)
}

// Only app views track the native windows their panels float into.
func (r *Registry) emitPanelClosed(descriptor PanelWindowDescriptor) {
	for _, target := range r.lifecycle.Names() {
		r.emitWindowEvent(target, panelwindow.WindowClosedEventName, panelwindow.WindowClosedEvent{WindowName: descriptor.WindowName, ClusterID: descriptor.ClusterID, GroupID: descriptor.GroupID})
	}
}

// BeginPanelWindowDock records a directory move while the native source stays
// live. The target app view learns of it from its next directory read.
func (r *Registry) BeginPanelWindowDock(windowName, targetPosition string, snapshot PanelGroupSnapshot) error {
	r.panelTransferMu.Lock()
	defer r.panelTransferMu.Unlock()
	if targetPosition != "right" && targetPosition != "bottom" {
		return fmt.Errorf("unsupported panel dock position %q", targetPosition)
	}
	if snapshot.SourceWindowName != windowName {
		return fmt.Errorf("panel dock source does not match caller")
	}
	if err := ValidatePanelGroupSnapshot(snapshot); err != nil {
		return err
	}
	target, err := r.appWindowForCluster(snapshot.ClusterID, windowName)
	if err != nil {
		return err
	}
	if err := r.panels.BeginDock(windowName, snapshot); err != nil {
		return err
	}
	location := panelwindow.PanelLocation{Kind: panelwindow.PanelLocationDocked, WindowName: target, GroupID: targetPosition, Index: panelwindow.AppendToGroup}
	if err := r.beginGroupPlacement(windowName, snapshot, location); err != nil {
		_ = r.panels.FailTransfer(windowName, snapshot.TransferID)
		return err
	}
	r.panels.setTransferTimeout(windowName, snapshot.TransferID, r.panelDockTimeout, func() {
		current, err := r.panels.Descriptor(windowName)
		if err == nil && current.State == PanelWindowStateDocking && current.TransferID == snapshot.TransferID {
			_ = r.FailPanelWindowTransfer(windowName, windowName, snapshot.TransferID)
		}
	})
	r.emitWorkspaceChanged(snapshot.ClusterID)
	return nil
}

// AcknowledgePanelTransfer settles a directory move the caller was asked to
// reconstruct: mounted commits it; otherwise the move is cancelled and the
// source keeps its panels. The owning handoff is found by transfer ID.
func (r *Registry) AcknowledgePanelTransfer(targetWindow, transferID string, mounted bool) error {
	if r.hasPanelTabTransfer(transferID) {
		return r.settlePanelTabTransfer(targetWindow, transferID, mounted)
	}
	windowName, pending := r.panels.TransferWindow(transferID)
	if !pending {
		return fmt.Errorf("stale panel transfer %q", transferID)
	}
	if !mounted {
		return r.FailPanelWindowTransfer(targetWindow, windowName, transferID)
	}
	return r.acknowledgePanelWindowDock(targetWindow, windowName, transferID)
}

// acknowledgePanelWindowDock closes the now-redundant source window, commits the
// directory move to the acknowledging app view, and removes the native role.
func (r *Registry) acknowledgePanelWindowDock(targetWindow, windowName, transferID string) error {
	r.panelTransferMu.Lock()
	defer r.panelTransferMu.Unlock()
	descriptor, err := r.commitPanelWindowDock(targetWindow, windowName, transferID)
	if descriptor.WindowName == "" {
		return err
	}
	releaseErr := r.releaseNativePanelReference(windowName)
	r.emitWorkspaceChanged(descriptor.ClusterID)
	return errors.Join(err, releaseErr)
}

// Returns the descriptor once the native source is closed, even if a concurrent
// cluster removal discarded the move, so the caller still releases the window.
func (r *Registry) commitPanelWindowDock(targetWindow, windowName, transferID string) (PanelWindowDescriptor, error) {
	r.workspaceMu.Lock()
	defer r.workspaceMu.Unlock()
	descriptor, err := r.panels.Descriptor(windowName)
	if err != nil {
		return PanelWindowDescriptor{}, err
	}
	if _, err := r.panels.Pending(windowName, transferID, PanelWindowStateDocking); err != nil {
		return PanelWindowDescriptor{}, err
	}
	if target, ok := r.workspace.TransferTarget(transferID); !ok || target.WindowName != targetWindow {
		return PanelWindowDescriptor{}, fmt.Errorf("panel dock target does not match caller")
	}
	if !r.windowHasCluster(targetWindow, descriptor.ClusterID) {
		return PanelWindowDescriptor{}, fmt.Errorf("dock target no longer displays the cluster")
	}
	if !r.closeAuthorizedWindow(windowName) {
		_ = r.panels.FailTransfer(windowName, transferID)
		r.emitDockFailure(descriptor)
		r.emitWorkspaceChanged(descriptor.ClusterID)
		return PanelWindowDescriptor{}, fmt.Errorf("panel window %q is not available for dock commit", windowName)
	}
	commitErr := r.workspace.CommitGroupTransfer(transferID)
	r.failPanelTabTransfersForWindow(windowName, "panel window moved as a whole group")
	return descriptor, errors.Join(commitErr, r.panels.AcknowledgeDock(windowName, transferID))
}

func (r *Registry) FailPanelWindowTransfer(callerWindowName, windowName, transferID string) error {
	r.panelTransferMu.Lock()
	defer r.panelTransferMu.Unlock()
	descriptor, err := r.panels.Descriptor(windowName)
	if err != nil {
		return err
	}
	if !r.isPanelTransferParticipant(descriptor, callerWindowName) {
		return fmt.Errorf("window %q cannot fail panel transfer for %q", callerWindowName, windowName)
	}
	wasOpening := descriptor.State == PanelWindowStateOpening
	restoring := r.restoringWindow(windowName)
	if err := r.panels.FailTransfer(windowName, transferID); err != nil {
		return err
	}
	if !wasOpening {
		r.emitDockFailure(descriptor)
		r.emitWorkspaceChanged(descriptor.ClusterID)
		return nil
	}
	r.failPanelTabTransfer(transferID, "new panel target failed before readiness")
	if restoring {
		// A workspace switch placed this window's panels directly; nothing else
		// takes them back.
		r.dropRestoredPanelPlacement(windowName, descriptor.ClusterID)
	}
	var closeErr error
	if !r.closeAuthorizedWindow(windowName) {
		closeErr = fmt.Errorf("panel window %q is not available", windowName)
	}
	releaseErr := r.releaseNativePanelReference(windowName)
	r.emitPanelClosed(descriptor)
	return errors.Join(closeErr, releaseErr)
}

// A native window may fail its own transfer; an opening window's source and a
// dock's target app view may fail theirs.
func (r *Registry) isPanelTransferParticipant(descriptor PanelWindowDescriptor, caller string) bool {
	switch {
	case caller == descriptor.WindowName:
		return true
	case descriptor.State == PanelWindowStateOpening:
		return caller == r.panels.OpeningSource(descriptor.WindowName)
	case descriptor.State == PanelWindowStateDocking:
		target, ok := r.workspace.TransferTarget(descriptor.TransferID)
		return ok && caller == target.WindowName
	}
	return false
}

func (r *Registry) RoutePanelWindowCommand(windowName string, command panelwindow.WorkspaceCommand) error {
	if !command.Valid() {
		return fmt.Errorf("panel command %q cannot be routed", command)
	}
	descriptor, err := r.panels.Descriptor(windowName)
	if err != nil {
		return err
	}
	target, err := r.appWindowForCluster(descriptor.ClusterID, windowName)
	if err != nil {
		return err
	}
	if !r.queueWorkspaceEvent(target, string(command), nil) {
		return fmt.Errorf("app window %q is not available", target)
	}
	if !r.focusWindow(target) {
		return fmt.Errorf("app window %q is not available", target)
	}
	return nil
}

// PublishPanelWindowGroup reports a live native window's arrangement. Like an
// app view's report, it only arranges the panels the directory places there.
func (r *Registry) PublishPanelWindowGroup(windowName string, group panelwindow.WorkspaceGroup) error {
	r.panelTransferMu.Lock()
	defer r.panelTransferMu.Unlock()
	r.workspaceMu.Lock()
	defer r.workspaceMu.Unlock()
	if err := r.panels.ValidatePublication(windowName, group); err != nil {
		return err
	}
	if err := r.workspace.PublishWindow(windowName, panelwindow.PanelLocationWindow, []panelwindow.WorkspaceGroup{group}); err != nil {
		return err
	}
	r.emitWorkspaceChanged(group.ClusterID)
	return nil
}

func (r *Registry) RequestPanelTabClose(windowName, panelID string) error {
	descriptor, err := r.PanelDescriptor(windowName)
	if err != nil {
		return err
	}
	for _, tab := range descriptor.Group.Tabs {
		if tab.PanelID != panelID {
			continue
		}
		if r.emitWindowEvent(windowName, panelwindow.TabCloseAuthorizedEventName, panelwindow.TabCloseAuthorizedEvent{PanelID: panelID}) {
			return nil
		}
		return fmt.Errorf("panel window %q is not available", windowName)
	}
	return fmt.Errorf("panel %q is not in window %q", panelID, windowName)
}

// AcknowledgePanelWindowClose runs after local tab guards or forced cluster
// removal. Native destruction precedes removal of the panel directory entries
// and release of its runtime references.
func (r *Registry) AcknowledgePanelWindowClose(windowName string) error {
	if r.switchParticipant(windowName) {
		return panelwindow.ErrWorkspaceSwitching
	}
	open, err := r.closePanelWindow(windowName)
	if err == nil && !open {
		return fmt.Errorf("panel window %q is not live", windowName)
	}
	return err
}

// closePanelWindow closes a panel window and reports whether it was open.
func (r *Registry) closePanelWindow(windowName string) (bool, error) {
	r.panelTransferMu.Lock()
	defer r.panelTransferMu.Unlock()
	descriptor, err := r.panels.Descriptor(windowName)
	if err != nil {
		return false, nil
	}
	if !r.closeAuthorizedWindow(windowName) {
		return true, fmt.Errorf("panel window %q is not available", windowName)
	}
	r.failPanelTabTransfersForWindow(windowName, "panel window closed during tab transfer")
	r.workspaceMu.Lock()
	r.panels.Remove(windowName)
	r.workspace.RemoveWindow(windowName)
	r.workspaceMu.Unlock()
	r.releaseUnusedPanelWorkspace(descriptor.ClusterID)
	if err := r.releaseNativePanelReference(windowName); err != nil {
		return true, err
	}
	r.emitPanelClosed(descriptor)
	r.emitWorkspaceChanged(descriptor.ClusterID)
	return true, nil
}

func (r *Registry) AcknowledgeWorkspaceWindowClose(windowName string) error {
	if !r.lifecycle.Contains(windowName) {
		return fmt.Errorf("app window %q is not live", windowName)
	}
	if r.switchParticipant(windowName) {
		return panelwindow.ErrWorkspaceSwitching
	}
	if r.closeAuthorizedWindow(windowName) {
		return nil
	}
	return fmt.Errorf("app window %q is not available", windowName)
}

func (r *Registry) AcknowledgeApplicationQuitPreflight(
	callerWindowName string,
	transactionID string,
	allowed bool,
) error {
	r.quitMu.Lock()
	pending := r.pendingQuit
	if pending == nil || pending.transactionID != transactionID {
		r.quitMu.Unlock()
		return fmt.Errorf("stale application quit transaction %q", transactionID)
	}
	if _, waiting := pending.waiting[callerWindowName]; !waiting {
		r.quitMu.Unlock()
		return fmt.Errorf("workspace %q is not awaiting application quit preflight", callerWindowName)
	}
	if !allowed {
		r.pendingQuit = nil
		r.quitMu.Unlock()
		r.finishDeniedApplicationPreflight(pending)
		return nil
	}
	delete(pending.waiting, callerWindowName)
	if len(pending.waiting) > 0 {
		r.quitMu.Unlock()
		return nil
	}
	if pending.timeout != nil {
		pending.timeout.Stop()
	}
	if pending.replacement != nil {
		// As for quit below: a collection timeout already waiting on quitMu must
		// not release the frozen renderers while the switch runs.
		r.pendingQuit = &applicationQuitPreflight{
			transactionID: pending.transactionID,
			participants:  pending.participants,
			replacement:   pending.replacement,
		}
		// Sent before the unlock: a cancellation can claim the approved preflight
		// only afterwards, so its own answer can never fill the buffer first and
		// leave this send with no reader.
		pending.replacement <- nil
		r.quitMu.Unlock()
		return nil
	}
	// Replace the collection phase so an already-running collection timeout
	// cannot cancel an approved handoff. Keep renderers frozen until shutdown.
	approved := &applicationQuitPreflight{
		transactionID: pending.transactionID,
		participants:  pending.participants,
	}
	r.pendingQuit = approved
	if r.quitPreflightTimeout > 0 {
		approved.timeout = time.AfterFunc(r.quitPreflightTimeout, func() {
			r.cancelApplicationQuitPreflight(approved, context.DeadlineExceeded)
		})
	}
	r.quitMu.Unlock()
	if r.requestApplicationQuit == nil {
		r.cancelApplicationQuitPreflight(approved, context.Canceled)
		return fmt.Errorf("application quit is unavailable")
	}
	// Closing individual views would remove their clusters from saved selection.
	// Let Wails reenter ShouldQuit and tear down the process after persistence.
	r.requestApplicationQuit()
	return nil
}

func cancelWindowEvent(event *application.WindowEvent) {
	if event != nil {
		event.Cancel()
	}
}

// refuseUnauthorizedAppClose keeps an app window open when the registry did not
// ask for the close: a window whose renderer can answer is asked to run its
// close guards first. One that cannot (still loading, or showing its crash
// screen) has no guard to run and closes. It reports whether the close was
// refused.
func (r *Registry) refuseUnauthorizedAppClose(event *application.WindowEvent, name string) bool {
	// A workspace switch is about to close this window itself.
	if r.switchParticipant(name) {
		cancelWindowEvent(event)
		return true
	}
	if !r.rendererReady(name) {
		return false
	}
	cancelWindowEvent(event)
	r.emitWindowEvent(name, panelwindow.WorkspaceCloseRequestedEventName, panelwindow.WorkspaceCloseRequestedEvent{WindowName: name})
	return true
}

func (r *Registry) handleClosing(event *application.WindowEvent, name string) {
	if !r.consumeAuthorizedClose(name) && r.refuseUnauthorizedAppClose(event, name) {
		return
	}
	// A window a workspace switch is waiting for can no longer answer it. The
	// switch goes on once this close has released what the window held.
	defer r.failRestoreOfClosedWindow(name)
	if err := r.failClusterTransfersForWindow(name); err != nil {
		r.reportPanelLifecycleError(err, "cancel cluster transfer before close")
		if event != nil {
			event.Cancel()
		}
		return
	}
	remaining, tracked := r.lifecycle.BeginClose(name)
	if !tracked {
		return
	}
	r.failPanelTabTransfersForWindow(name, "app window closed during tab transfer")
	r.declinePanelMovesInto(name)
	if r.releaseClosedAppView(name, remaining) {
		return
	}
	if r.backend.PrepareQuitFromWindow(name) {
		r.retainClosedWorkspace(name)
		return
	}
	// The refused quit ends whichever preflight is pending, approved or not.
	r.cancelPendingApplicationQuitPreflight(func(*applicationQuitPreflight) bool { return true }, context.Canceled)
	r.lifecycle.CancelClose(name)
	if event != nil {
		event.Cancel()
	}
}

// A closing app view declines every move the directory is taking into it, as
// its renderer declines one it cannot mount, so each source keeps its panels at
// once instead of at the move's timeout. Cluster-view moves were already
// cancelled with their handoff (failClusterTransfersForWindow).
func (r *Registry) declinePanelMovesInto(windowName string) {
	for _, transferID := range r.workspace.MovesInto(windowName) {
		r.reportPanelLifecycleError(r.AcknowledgePanelTransfer(windowName, transferID, false), "decline a move into a closing app view")
	}
}

// Closing the last app view while panels remain is not process Quit. Save its
// geometry before releasing its presentation, while the native window still exists.
func (r *Registry) releaseClosedAppView(name string, remaining int) bool {
	// During a workspace switch the last view is released like any other: the
	// previous windows are already detached and more saved windows may be on
	// their way. The switch quits at its end if no window is left.
	if remaining == 0 && len(r.panels.Names("")) == 0 && r.activeRestore.Load() == nil {
		return false
	}
	if remaining == 0 {
		r.backend.SaveWorkspaceWindowGeometry(name)
	}
	r.retainClosedWorkspace(name)
	r.backend.ReleaseWorkspaceWindow(name)
	return true
}

func (r *Registry) retainClosedWorkspace(name string) {
	r.forgetWorkspaceReady(name)
	if r.unpublishedRestoredWindow(name) {
		// A target that closes during presentation must not pass its saved
		// panels to the surviving source as retained panels.
		r.workspace.RemoveWindow(name)
		return
	}
	r.workspace.RetainWindow(name)
}

func cascadedCoordinate(position, size, limit int) int {
	maxPosition := limit - size
	if maxPosition < 0 {
		maxPosition = 0
	}
	forward := position + cascadeOffset
	if forward >= 0 && forward <= maxPosition {
		return forward
	}
	backward := position - cascadeOffset
	if backward >= 0 && backward <= maxPosition {
		return backward
	}
	if position < 0 {
		return 0
	}
	if position > maxPosition {
		return maxPosition
	}
	return position
}

// FocusMostRecent shows and focuses the most recently active live peer.
func (r *Registry) FocusMostRecent() {
	focusApplicationWindow(r.application, r.lifecycle.MostRecent())
}

// rendererReady reports whether a window's renderer has announced that it is
// mounted, from the page the window is showing now. Only then are its capture
// and close-guard handlers subscribed: the native runtime is ready earlier, a
// reload drops them, and a crash screen unmounts them.
func (r *Registry) rendererReady(name string) bool {
	r.closeMu.Lock()
	defer r.closeMu.Unlock()
	_, ready := r.panelWorkspaceReady[name]
	return ready
}

// enterRendererPageLocked checks a readiness call against the latest page.
// Hold closeMu through the ensuing readiness update so an earlier page cannot
// overwrite a later page's state.
func (r *Registry) enterRendererPageLocked(name string, page int64) (current, reloaded bool) {
	last := r.rendererPage[name]
	if page < last {
		return false, false
	}
	if r.rendererPage == nil {
		r.rendererPage = make(map[string]int64)
	}
	r.rendererPage[name] = page
	return true, page > last
}

func (r *Registry) markRendererReadyLocked(name string) {
	if r.panelWorkspaceReady == nil {
		r.panelWorkspaceReady = make(map[string]struct{})
	}
	r.panelWorkspaceReady[name] = struct{}{}
}

func (r *Registry) forgetRendererReady(name string) {
	r.closeMu.Lock()
	defer r.closeMu.Unlock()
	delete(r.panelWorkspaceReady, name)
}

// WithdrawRendererReady is a renderer saying it cannot answer: its page has
// just started loading, or a crash screen replaced its app tree. It is left
// out of save, switch and quit until it announces again.
func (r *Registry) WithdrawRendererReady(name string, page int64) error {
	r.closeMu.Lock()
	current, _ := r.enterRendererPageLocked(name, page)
	_, announced := r.panelWorkspaceReady[name]
	if current {
		delete(r.panelWorkspaceReady, name)
	}
	r.closeMu.Unlock()
	if !current {
		return nil
	}
	r.cancelRendererRequests(name)
	if announced {
		// A page that had announced was working on its saved view.
		r.failRestoreOfClosedWindow(name)
	}
	return nil
}

// switchParticipant reports whether a workspace switch has asked this window
// to approve and has not finished. Such a window does not close on its own:
// the switch works from the windows it asked, and closes them itself.
func (r *Registry) switchParticipant(name string) bool {
	r.quitMu.Lock()
	defer r.quitMu.Unlock()
	return r.pendingQuit != nil && r.pendingQuit.replacement != nil && slices.Contains(r.pendingQuit.participants, name)
}

// rendererLost records that a window's renderer can no longer answer, and ends
// what was waiting for its answer now instead of at a deadline: a capture
// fails, and a quit preflight, switch preflight or cluster close is cancelled
// as a timeout would.
func (r *Registry) rendererLost(name string) {
	r.forgetRendererReady(name)
	r.cancelRendererRequests(name)
}

func (r *Registry) cancelRendererRequests(name string) {
	r.failCaptureOfClosedWindow(name)
	r.cancelPendingApplicationQuitPreflight(func(pending *applicationQuitPreflight) bool {
		_, waiting := pending.waiting[name]
		return waiting
	}, panelwindow.WorkspaceConflict("a window stopped responding during workspace switch"))
	r.cancelClusterPanelClosesWaitingOn(name)
}

// readyWorkspaceNames lists the windows that can answer a request sent to every
// window: a quit preflight, a workspace capture, a workspace switch.
func (r *Registry) readyWorkspaceNames() []string {
	ready := make([]string, 0)
	for _, name := range r.lifecycle.Names() {
		if r.rendererReady(name) {
			ready = append(ready, name)
		}
	}
	for _, name := range r.panels.Names("") {
		if r.panels.State(name) == PanelWindowStateLive && r.rendererReady(name) {
			ready = append(ready, name)
		}
	}
	return ready
}

func (r *Registry) finishDeniedApplicationPreflight(pending *applicationQuitPreflight) {
	if pending.timeout != nil {
		pending.timeout.Stop()
	}
	r.settleApplicationQuitPreflight(pending)
	if pending.replacement != nil {
		pending.replacement <- errNamedWorkspaceOpenCancelled
	}
}

func (r *Registry) expireApplicationQuitPreflight(pending *applicationQuitPreflight) {
	r.cancelApplicationQuitPreflight(pending, context.DeadlineExceeded)
}

func (r *Registry) cancelApplicationQuitPreflight(pending *applicationQuitPreflight, cause error) {
	r.cancelPendingApplicationQuitPreflight(func(current *applicationQuitPreflight) bool { return current == pending }, cause)
}

// cancelPendingApplicationQuitPreflight ends the pending preflight if owns
// accepts it. The check and the claim share one quitMu hold: an approval that
// arrives between them would install an object the caller never saw, and its
// renderers would stay frozen with nothing left to release them.
func (r *Registry) cancelPendingApplicationQuitPreflight(owns func(*applicationQuitPreflight) bool, cause error) {
	r.quitMu.Lock()
	pending := r.pendingQuit
	if pending == nil || !owns(pending) {
		r.quitMu.Unlock()
		return
	}
	if pending.timeout != nil {
		pending.timeout.Stop()
	}
	r.pendingQuit = nil
	r.quitMu.Unlock()
	r.settleApplicationQuitPreflight(pending)
	if pending.replacement != nil {
		select {
		case pending.replacement <- cause:
		default:
		}
	}
}

func (r *Registry) settleApplicationQuitPreflight(pending *applicationQuitPreflight) {
	// Approved renderers have left waiting, but must also be released on denial,
	// timeout, or rejected quit handoff. Event consumers may synchronously reenter.
	for _, name := range pending.participants {
		r.emitWindowEvent(name, panelwindow.ApplicationQuitPreflightSettledEventName, panelwindow.ApplicationQuitPreflightRequestedEvent{
			TransactionID: pending.transactionID, WindowName: name,
		})
	}
}

func (r *Registry) beginApplicationQuitPreflightLocked(
	readyWorkspaces []string,
) *applicationQuitPreflight {
	r.nextQuit++
	pending := &applicationQuitPreflight{
		transactionID: fmt.Sprintf("application-quit-%d", r.nextQuit),
		participants:  append([]string(nil), readyWorkspaces...),
		waiting:       make(map[string]struct{}, len(readyWorkspaces)),
	}
	for _, workspaceName := range readyWorkspaces {
		pending.waiting[workspaceName] = struct{}{}
	}
	if r.quitPreflightTimeout > 0 {
		pending.timeout = time.AfterFunc(r.quitPreflightTimeout, func() {
			r.expireApplicationQuitPreflight(pending)
		})
	}
	r.pendingQuit = pending
	return pending
}

func (r *Registry) emitApplicationQuitPreflight(
	pending *applicationQuitPreflight,
	readyWorkspaces []string,
) {
	for _, workspaceName := range readyWorkspaces {
		if !r.emitWindowEvent(workspaceName, panelwindow.ApplicationQuitPreflightRequestedEventName, panelwindow.ApplicationQuitPreflightRequestedEvent{
			TransactionID: pending.transactionID, SwitchingWorkspace: pending.replacement != nil,
			WindowName: workspaceName,
		}) {
			r.cancelApplicationQuitPreflight(pending, fmt.Errorf("could not reach window %q for quit preflight", workspaceName))
			return
		}
	}
}

func (r *Registry) finishApprovedApplicationQuitLocked() bool {
	pending := r.pendingQuit
	if pending.timeout != nil {
		pending.timeout.Stop()
	}
	// A timer already waiting on quitMu must not release renderers during flush.
	pending = &applicationQuitPreflight{
		transactionID: pending.transactionID,
		participants:  pending.participants,
	}
	r.pendingQuit = pending
	mostRecent := r.lifecycle.MostRecent()
	r.quitMu.Unlock()
	if r.backend.PrepareQuitFromWindow(mostRecent) {
		return true
	}
	r.cancelApplicationQuitPreflight(pending, context.Canceled)
	return false
}

// PrepareApplicationQuit performs the shared last-window quit preparation.
func (r *Registry) PrepareApplicationQuit() bool {
	if r == nil || r.backend == nil || r.lifecycle == nil {
		return true
	}
	r.quitMu.Lock()
	if r.pendingQuit != nil && r.pendingQuit.replacement == nil && len(r.pendingQuit.waiting) == 0 {
		return r.finishApprovedApplicationQuitLocked()
	}
	if r.pendingQuit != nil {
		r.quitMu.Unlock()
		return false
	}
	readyWorkspaces := r.readyWorkspaceNames()
	if len(readyWorkspaces) == 0 {
		mostRecent := r.lifecycle.MostRecent()
		r.quitMu.Unlock()
		return r.backend.PrepareQuitFromWindow(mostRecent)
	}
	pending := r.beginApplicationQuitPreflightLocked(readyWorkspaces)
	r.quitMu.Unlock()
	r.emitApplicationQuitPreflight(pending, readyWorkspaces)
	return false
}

// Count returns the number of live peer windows tracked by the registry.
func (r *Registry) Count() int {
	return r.lifecycle.Count()
}

func windowOptions(name string) application.WebviewWindowOptions {
	return windowOptionsForPlatform(name, runtime.GOOS)
}

func panelWindowOptions(
	name string,
	initialBounds *panelwindow.WindowBounds,
) application.WebviewWindowOptions {
	return panelWindowOptionsForPlatform(name, runtime.GOOS, initialBounds)
}

func panelWindowOptionsForPlatform(
	name string,
	goos string,
	initialBounds *panelwindow.WindowBounds,
) application.WebviewWindowOptions {
	options := sharedWindowOptions(name, goos)
	if goos == "linux" {
		// Wails substitutes Name when Title is empty on initial Linux creation.
		// A space prevents that fallback until the native title is cleared.
		options.Title = " "
	}
	options.Width = 500
	options.Height = 400
	options.MinWidth = panelWindowMinWidth
	options.MinHeight = panelWindowMinHeight
	options.Hidden = true
	if initialBounds != nil {
		options.Width = max(initialBounds.Width, options.MinWidth)
		options.Height = max(initialBounds.Height, options.MinHeight)
		options.InitialPosition = application.WindowXY
		options.X = initialBounds.X
		options.Y = initialBounds.Y
	}
	return options
}

func constrainWindowOptions(options *application.WebviewWindowOptions, workArea application.Rect) {
	if options == nil || workArea.Width <= 0 || workArea.Height <= 0 {
		return
	}
	options.Width = min(options.Width, max(workArea.Width, options.MinWidth))
	options.Height = min(options.Height, max(workArea.Height, options.MinHeight))
	maxX := workArea.X + max(workArea.Width-options.Width, 0)
	maxY := workArea.Y + max(workArea.Height-options.Height, 0)
	options.X = min(max(options.X, workArea.X), maxX)
	options.Y = min(max(options.Y, workArea.Y), maxY)
}

func positionPanelWindowOptions(options *application.WebviewWindowOptions, owner geometry) bool {
	if options == nil || owner.Width <= 0 || owner.Height <= 0 {
		return false
	}
	options.X = owner.AbsoluteX + (owner.Width-options.Width)/2
	options.Y = owner.AbsoluteY + (owner.Height-options.Height)/2
	if owner.Screen != nil {
		constrainWindowOptions(options, owner.Screen.WorkArea)
	}
	return true
}

func windowOptionsForPlatform(name, goos string) application.WebviewWindowOptions {
	options := sharedWindowOptions(name, goos)
	options.Title = "Luxury Yacht"
	options.Width = 1200
	options.Height = 800
	options.MinWidth = appWindowMinWidth
	options.MinHeight = appWindowMinHeight
	options.Hidden = goos != "linux"
	return options
}

func sharedWindowOptions(name, goos string) application.WebviewWindowOptions {
	backgroundType := application.BackgroundTypeTransparent
	if goos == "windows" {
		backgroundType = application.BackgroundTypeSolid
	}
	return application.WebviewWindowOptions{
		Name:             name,
		URL:              "/",
		BackgroundColour: application.NewRGB(30, 30, 30),
		BackgroundType:   backgroundType,
		Frameless:        goos != "darwin",
		Mac:              sharedMacWindowChrome(),
		Windows: application.WindowsWindow{
			Theme:       application.SystemDefault,
			DisableMenu: goos == "windows",
			// Keep pointer input in the DOM so Wails can resize before dragging.
			NonClientRegionSupport: false,
		},
		UseApplicationMenu: goos == "darwin",
		Zoom:               1,
		ZoomControlEnabled: false,
	}
}

func sharedMacWindowChrome() application.MacWindow {
	return application.MacWindow{
		TitleBar: application.MacTitleBar{
			AppearsTransparent:   true,
			FullSizeContent:      true,
			HideTitle:            true,
			HideToolbarSeparator: true,
		},
	}
}

func (r *Registry) emitDockFailure(descriptor PanelWindowDescriptor) {
	event := panelwindow.WindowTransferFailedEvent{WindowName: descriptor.WindowName, TransferID: descriptor.TransferID, ClusterID: descriptor.ClusterID}
	targets := append(r.lifecycle.Names(), descriptor.WindowName)
	for _, target := range targets {
		if r.windowHasCluster(target, descriptor.ClusterID) {
			r.emitWindowEvent(target, panelwindow.WindowTransferFailedEventName, event)
		}
	}
}

func (r *Registry) transferredPanelWindowOptions(windowName string, snapshot PanelGroupSnapshot) application.WebviewWindowOptions {
	options := panelWindowOptions(windowName, snapshot.InitialBounds)
	if snapshot.InitialBounds != nil {
		positioned := false
		if snapshot.UseInitialPosition {
			positioned = r.positionWindowAtTransferredBounds(
				&options,
				*snapshot.InitialBounds,
				snapshot.InitialPositionAnchor,
			)
		} else if r.windowGeometry != nil {
			if ownerGeometry, ok := r.windowGeometry(snapshot.SourceWindowName); ok {
				positioned = positionPanelWindowOptions(&options, ownerGeometry)
			}
		}
		if !positioned {
			options.InitialPosition = application.WindowCentered
		}
	}
	return options
}
