package appwindow

import (
	"errors"
	"fmt"
	"runtime"
	"sync"
	"time"

	"github.com/luxury-yacht/app/internal/panelwindow"
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

type lifecycleBackend interface {
	WindowRuntimeReady(windowName string, restoreGeometry bool) bool
	ReleaseWorkspaceWindow(windowID string)
	PrepareQuitFromWindow(windowName string) bool
	WindowClusterIDs(string) []string
	panelwindow.ClusterViewTransferLifecycle
	PanelWorkspaceDirectory() *panelwindow.WorkspaceDirectory
	RetainPanelCluster(string, string) error
	ReleasePanelCluster(string) error
}

// Registry owns the application's peer workspace windows and their lifecycle.
type Registry struct {
	clusterTransfers       map[string]*clusterViewTransfer
	usedClusterTransferIDs map[string]struct{}
	application            *application.App
	backend                lifecycleBackend
	lifecycle              *lifecycle
	panels                 *panelIndex
	workspace              *panelwindow.WorkspaceDirectory
	workspaceMu            sync.Mutex
	newWindow              func(application.WebviewWindowOptions) *application.WebviewWindow
	configurePanelWindow   func(*application.WebviewWindow)
	showWindow             func(string) bool
	closeWindow            func(string) bool
	focusWindow            func(string) bool
	emitWindowEvent        func(string, string, any) bool
	windowGeometry         func(string) (geometry, bool)
	screenWorkAreas        func() []application.Rect
	closeMu                sync.Mutex
	authorizedClose        map[string]struct{}
	workspaceReady         map[string]struct{}
	panelWorkspaceReady    map[string]struct{}
	queuedWorkspaceEvents  map[string][]workspaceWindowEvent
	panelOpenTimeout       time.Duration
	quitMu                 sync.Mutex
	nextQuit               uint64
	pendingQuit            *applicationQuitPreflight
	quitApproved           bool
	quitApprovalTimeout    *time.Timer
	quitPreflightTimeout   time.Duration
	panelTransferMu        sync.Mutex
	tabTransferMu          sync.Mutex
	pendingTabTransfers    map[string]*panelTabTransfer
	usedTabTransferIDs     map[string]struct{}
	tabTransferTimeout     time.Duration
}

type applicationQuitPreflight struct {
	transactionID string
	waiting       map[string]struct{}
	timeout       *time.Timer
}

func (r *Registry) setQuitApprovedLocked(approved bool) {
	if r.quitApprovalTimeout != nil {
		r.quitApprovalTimeout.Stop()
		r.quitApprovalTimeout = nil
	}
	r.quitApproved = approved
	if !approved || r.quitPreflightTimeout <= 0 {
		return
	}
	r.quitApprovalTimeout = time.AfterFunc(r.quitPreflightTimeout, func() {
		r.quitMu.Lock()
		defer r.quitMu.Unlock()
		r.quitApproved = false
		r.quitApprovalTimeout = nil
	})
}

type geometry struct {
	AbsoluteX int
	AbsoluteY int
	X         int
	Y         int
	Width     int
	Height    int
	Maximised bool
	Screen    *application.Screen
}

const cascadeOffset = 24

func showApplicationWindow(app *application.App, name string) bool {
	window, ok := app.Window.GetByName(name)
	if !ok {
		return false
	}
	window.Show()
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
		Width:     width,
		Height:    height,
		Maximised: window.IsMaximised(),
	}
	result.AbsoluteX, result.AbsoluteY = window.Position()
	if screen, err := window.GetScreen(); err == nil && screen != nil {
		result.X, result.Y = window.RelativePosition()
		result.Screen = screen
	}
	return result, true
}

func bindApplicationWindowOperations(registry *Registry, app *application.App) {
	registry.newWindow = app.Window.NewWithOptions
	registry.showWindow = func(name string) bool {
		return showApplicationWindow(app, name)
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
}

// NewRegistry creates the peer-window registry for a Wails application.
func NewRegistry(
	app *application.App,
	backend lifecycleBackend,
) *Registry {
	configureNativeTabDragAnimation()
	registry := &Registry{
		application:          app,
		backend:              backend,
		lifecycle:            newLifecycle(),
		panels:               newPanelIndex(),
		workspace:            panelwindow.NewWorkspaceDirectory(),
		authorizedClose:      make(map[string]struct{}),
		workspaceReady:       make(map[string]struct{}),
		panelOpenTimeout:     15 * time.Second,
		quitPreflightTimeout: 20 * time.Second,
		pendingTabTransfers:  make(map[string]*panelTabTransfer),
		usedTabTransferIDs:   make(map[string]struct{}),
		tabTransferTimeout:   15 * time.Second,
		configurePanelWindow: configureNativePanelWindow,
	}
	if backend != nil {
		registry.workspace = backend.PanelWorkspaceDirectory()
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
	r.panelTransferMu.Lock()
	defer r.panelTransferMu.Unlock()
	r.workspaceMu.Lock()
	defer r.workspaceMu.Unlock()
	if err := r.validateGroupSource(snapshot.SourceWindowName, snapshot); err != nil {
		return PanelWindowDescriptor{}, err
	}
	if err := r.retainPanelWorkspace(snapshot.ClusterID); err != nil {
		return PanelWindowDescriptor{}, err
	}
	descriptor, err := r.beginPanelWindowOpenTransfer(snapshot)
	if err != nil {
		return PanelWindowDescriptor{}, err
	}
	if err := r.backend.RetainPanelCluster(descriptor.WindowName, snapshot.ClusterID); err != nil {
		_ = r.panels.FailTransfer(descriptor.WindowName, snapshot.TransferID)
		return PanelWindowDescriptor{}, err
	}
	options := r.transferredPanelWindowOptions(descriptor.WindowName, snapshot)
	window := r.newWindow(options)
	if window == nil {
		_ = r.panels.FailTransfer(descriptor.WindowName, snapshot.TransferID)
		r.failPanelTabTransfer(snapshot.TransferID, "new panel target could not be created")
		return PanelWindowDescriptor{}, errors.Join(fmt.Errorf("create native panel window %q", descriptor.WindowName), r.releaseNativePanelReference(descriptor.WindowName))
	}
	if r.configurePanelWindow != nil {
		r.configurePanelWindow(window)
	}
	r.registerPanelLifecycleHooks(window, descriptor.WindowName)
	if r.panelOpenTimeout > 0 {
		time.AfterFunc(r.panelOpenTimeout, func() {
			r.expirePanelOpen(descriptor.WindowName, snapshot.TransferID)
		})
	}
	return descriptor, nil
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
	sourceName := r.lifecycle.MostRecent()
	name := r.lifecycle.Add()
	window := r.newWindow(r.optionsForPeer(name, sourceName, restoreGeometry))
	r.registerLifecycleHooks(window, name, restoreGeometry)
	return window
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
	window.OnWindowEvent(events.Common.WindowRuntimeReady, func(*application.WindowEvent) {
		r.backend.WindowRuntimeReady(name, restoreGeometry)
		r.markWorkspaceReady(name)
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

func (r *Registry) consumeAuthorizedClose(name string) bool {
	r.closeMu.Lock()
	defer r.closeMu.Unlock()
	if _, ok := r.authorizedClose[name]; !ok {
		return false
	}
	delete(r.authorizedClose, name)
	return true
}

func (r *Registry) markWorkspaceReady(name string) {
	r.closeMu.Lock()
	defer r.closeMu.Unlock()
	if r.workspaceReady == nil {
		r.workspaceReady = make(map[string]struct{})
	}
	r.workspaceReady[name] = struct{}{}
}

func (r *Registry) isWorkspaceReady(name string) bool {
	r.closeMu.Lock()
	defer r.closeMu.Unlock()
	_, ready := r.workspaceReady[name]
	return ready
}

func (r *Registry) forgetWorkspaceReady(name string) {
	r.closeMu.Lock()
	defer r.closeMu.Unlock()
	delete(r.workspaceReady, name)
	delete(r.panelWorkspaceReady, name)
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
	return r.panels.Descriptor(name)
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
			return NativeWindowDescriptor{
				SchemaVersion: NativeWindowDescriptorSchemaVersion,
				Role:          NativeWindowRolePanel,
				Panel:         &panel,
			}, nil
		}
	}
	return NativeWindowDescriptor{}, fmt.Errorf("native window %q is not registered", name)
}

// of one workspace.

// AcknowledgePanelWindowReady commits an opening transfer and reveals the
// hidden native target. A stale acknowledgement leaves the source transfer pending.
func (r *Registry) AcknowledgePanelWindowReady(name, transferID string) (PanelWindowDescriptor, error) {
	r.panelTransferMu.Lock()
	defer r.panelTransferMu.Unlock()
	r.workspaceMu.Lock()
	defer r.workspaceMu.Unlock()
	descriptor, err := r.panels.AcknowledgeOpen(name, transferID)
	if err != nil {
		return PanelWindowDescriptor{}, err
	}
	snapshot := descriptor.Snapshot
	previous := r.workspace.Snapshot(snapshot.ClusterID).Panels
	group := panelwindow.WorkspaceGroup{ClusterID: snapshot.ClusterID, GroupID: snapshot.GroupID, Tabs: snapshot.Tabs, ActivePanelID: snapshot.ActivePanelID}
	if err := r.workspace.TransferGroup(snapshot.SourceWindowName, name, panelwindow.PanelLocationWindow, group); err != nil {
		return PanelWindowDescriptor{}, errors.Join(err, r.abortReadyPanelWindow(descriptor))
	}
	if !r.showWindow(name) {
		r.restoreFailedPanelOpen(name, previous)
		return PanelWindowDescriptor{}, errors.Join(fmt.Errorf("panel window %q disappeared before ready", name), r.abortReadyPanelWindow(descriptor))
	}
	r.emitWindowEvent(snapshot.SourceWindowName, panelwindow.WindowOpenedEventName, panelwindow.WindowOpenedEvent{
		WindowName: name, TransferID: snapshot.TransferID, ClusterID: snapshot.ClusterID, GroupID: snapshot.GroupID, Snapshot: snapshot,
	})
	r.completePanelTabTransferForOpenedWindow(descriptor)
	r.emitWorkspaceChanged(snapshot.ClusterID)
	return descriptor, nil
}

func (r *Registry) emitPanelClosed(descriptor PanelWindowDescriptor) {
	targets := append(r.lifecycle.Names(), descriptor.Snapshot.SourceWindowName)
	sent := make(map[string]struct{})
	for _, target := range targets {
		if _, exists := sent[target]; exists {
			continue
		}
		sent[target] = struct{}{}
		r.emitWindowEvent(target, panelwindow.WindowClosedEventName, panelwindow.WindowClosedEvent{WindowName: descriptor.WindowName, ClusterID: descriptor.ClusterID, GroupID: descriptor.GroupID})
	}
}

// BeginPanelWindowDock records a target handoff while the native source stays
// live, then routes the complete snapshot to an app window displaying the same cluster.
func (r *Registry) BeginPanelWindowDock(windowName, targetPosition string, snapshot PanelGroupSnapshot) error {
	r.panelTransferMu.Lock()
	defer r.panelTransferMu.Unlock()
	if targetPosition != "right" && targetPosition != "bottom" {
		return fmt.Errorf("unsupported panel dock position %q", targetPosition)
	}
	if snapshot.SourceWindowName != windowName {
		return fmt.Errorf("panel dock source does not match caller")
	}
	if err := r.validateGroupSource(windowName, snapshot); err != nil {
		return err
	}
	target, err := r.appWindowForCluster(snapshot.ClusterID, windowName)
	if err != nil {
		return err
	}
	if err := r.panels.BeginDock(windowName, snapshot, target, targetPosition); err != nil {
		return err
	}
	time.AfterFunc(15*time.Second, func() {
		current, err := r.panels.Descriptor(windowName)
		if err == nil && current.State == PanelWindowStateDocking && current.Snapshot.TransferID == snapshot.TransferID {
			_ = r.FailPanelWindowTransfer(windowName, windowName, snapshot.TransferID)
		}
	})
	if !r.queueWorkspaceEvent(target, panelwindow.WindowDockRequestedEventName, panelwindow.WindowDockRequestedEvent{WindowName: windowName, TransferID: snapshot.TransferID, TargetPosition: targetPosition, Snapshot: snapshot}) {
		_ = r.panels.FailTransfer(windowName, snapshot.TransferID)
		descriptor, _ := r.panels.Descriptor(windowName)
		r.emitDockFailure(descriptor)
		return fmt.Errorf("app window %q is not available", target)
	}
	return nil
}

// AcknowledgePanelWindowDock commits the destination's reconstructed docked group,
// removes the native role, and closes the now-redundant source window.
func (r *Registry) AcknowledgePanelWindowDock(targetWindow, windowName, transferID string) error {
	r.panelTransferMu.Lock()
	defer r.panelTransferMu.Unlock()
	r.workspaceMu.Lock()
	defer r.workspaceMu.Unlock()
	descriptor, err := r.panels.Descriptor(windowName)
	if err != nil {
		return err
	}
	position, err := r.panels.DockTarget(windowName, transferID, targetWindow)
	if err != nil {
		return err
	}
	if !r.windowHasCluster(targetWindow, descriptor.ClusterID) {
		return fmt.Errorf("dock target no longer displays the cluster")
	}
	previous := r.workspace.Snapshot(descriptor.ClusterID).Panels
	group := panelwindow.WorkspaceGroup{ClusterID: descriptor.ClusterID, GroupID: position, Tabs: descriptor.Snapshot.Tabs, ActivePanelID: descriptor.Snapshot.ActivePanelID}
	if err := r.workspace.TransferGroup(windowName, targetWindow, panelwindow.PanelLocationDocked, group); err != nil {
		return err
	}
	r.authorizeClose(windowName)
	if !r.closeWindow(windowName) {
		r.consumeAuthorizedClose(windowName)
		r.restoreFailedPanelOpen(targetWindow, previous)
		_ = r.panels.FailTransfer(windowName, transferID)
		r.emitDockFailure(descriptor)
		return fmt.Errorf("panel window %q is not available for dock commit", windowName)
	}
	r.failPanelTabTransfersForWindow(windowName, "panel window moved as a whole group")
	if err := r.panels.AcknowledgeDock(windowName, transferID); err != nil {
		return err
	}
	r.backend.ReleaseWorkspaceWindow(windowName)
	if err := r.backend.ReleasePanelCluster(windowName); err != nil {
		return err
	}
	r.emitWorkspaceChanged(descriptor.ClusterID)
	return nil
}

func (r *Registry) FailPanelWindowTransfer(callerWindowName, windowName, transferID string) error {
	r.panelTransferMu.Lock()
	defer r.panelTransferMu.Unlock()
	descriptor, err := r.panels.Descriptor(windowName)
	if err != nil {
		return err
	}
	if !r.panels.IsTransferParticipant(windowName, callerWindowName) {
		return fmt.Errorf("window %q cannot fail panel transfer for %q", callerWindowName, windowName)
	}
	wasOpening := descriptor.State == PanelWindowStateOpening
	if err := r.panels.FailTransfer(windowName, transferID); err != nil {
		return err
	}
	if !wasOpening {
		r.emitDockFailure(descriptor)
		return nil
	}
	r.failPanelTabTransfer(transferID, "new panel target failed before readiness")
	r.authorizeClose(windowName)
	var closeErr error
	if !r.closeWindow(windowName) {
		r.consumeAuthorizedClose(windowName)
		closeErr = fmt.Errorf("panel window %q is not available", windowName)
	}
	releaseErr := r.releaseNativePanelReference(windowName)
	r.emitPanelClosed(descriptor)
	return errors.Join(closeErr, releaseErr)
}

func (r *Registry) FocusPanelWindow(callerWindow, windowName, panelID string) error {
	descriptor, err := r.panels.Descriptor(windowName)
	if err != nil {
		return err
	}
	if !r.windowHasCluster(callerWindow, descriptor.ClusterID) {
		return fmt.Errorf("caller does not display the panel cluster")
	}
	for _, tab := range descriptor.Snapshot.Tabs {
		if tab.PanelID == panelID {
			return r.focusWorkspacePanel(panelwindow.WorkspacePanel{Tab: tab, Location: panelwindow.PanelLocation{Kind: panelwindow.PanelLocationWindow, WindowName: windowName}})
		}
	}
	return fmt.Errorf("panel %q is not in window %q", panelID, windowName)
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

func (r *Registry) UpdatePanelWindowSnapshot(windowName string, snapshot PanelGroupSnapshot) error {
	r.panelTransferMu.Lock()
	defer r.panelTransferMu.Unlock()
	r.workspaceMu.Lock()
	defer r.workspaceMu.Unlock()
	if snapshot.SourceWindowName != windowName {
		return fmt.Errorf("panel snapshot source does not match its renderer")
	}
	if err := r.panels.ValidateSnapshot(windowName, snapshot); err != nil {
		return err
	}
	if err := r.publishPanelGroups(windowName, panelwindow.PanelLocationWindow, []panelwindow.WorkspaceGroup{{ClusterID: snapshot.ClusterID, GroupID: snapshot.GroupID, Tabs: snapshot.Tabs, ActivePanelID: snapshot.ActivePanelID}}); err != nil {
		return err
	}
	if err := r.panels.UpdateSnapshot(windowName, snapshot); err != nil {
		return err
	}
	r.emitWorkspaceChanged(snapshot.ClusterID)
	return nil
}

func (r *Registry) RequestPanelTabClose(windowName, panelID string) error {
	descriptor, err := r.panels.Descriptor(windowName)
	if err != nil {
		return err
	}
	for _, tab := range descriptor.Snapshot.Tabs {
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

// RequestPanelWindowClose validates the owner relationship and asks the child
// to run its local group guards before authorizing native destruction.
func (r *Registry) RequestPanelWindowClose(callerWindowName, windowName, reason string) error {
	descriptor, err := r.panels.Descriptor(windowName)
	if err != nil {
		return err
	}
	if !r.windowHasCluster(callerWindowName, descriptor.ClusterID) {
		return fmt.Errorf("window %q cannot close panel window %q", callerWindowName, windowName)
	}
	if !r.emitWindowEvent(windowName, panelwindow.WindowCloseRequestedEventName, panelwindow.WindowCloseRequestedEvent{
		WindowName: windowName,
		Reason:     reason,
	}) {
		return fmt.Errorf("panel window %q is not available", windowName)
	}
	return nil
}

// AcknowledgePanelWindowClose is called only after the child has passed every
// tab guard and the owner has removed the corresponding directory entries.
func (r *Registry) AcknowledgePanelWindowClose(windowName string) error {
	r.panelTransferMu.Lock()
	defer r.panelTransferMu.Unlock()
	descriptor, err := r.panels.Descriptor(windowName)
	if err != nil {
		return err
	}
	r.authorizeClose(windowName)
	if !r.closeWindow(windowName) {
		r.consumeAuthorizedClose(windowName)
		return fmt.Errorf("panel window %q is not available", windowName)
	}
	r.failPanelTabTransfersForWindow(windowName, "panel window closed during tab transfer")
	r.workspaceMu.Lock()
	r.panels.Remove(windowName)
	r.workspace.RemoveWindow(windowName)
	r.releaseUnusedPanelWorkspace(descriptor.ClusterID)
	r.workspaceMu.Unlock()
	if r.backend != nil {
		r.backend.ReleaseWorkspaceWindow(windowName)
		if err := r.backend.ReleasePanelCluster(windowName); err != nil {
			return err
		}
	}
	r.emitPanelClosed(descriptor)
	r.emitWorkspaceChanged(descriptor.ClusterID)
	return nil
}

func (r *Registry) AcknowledgeWorkspaceWindowClose(windowName string) error {
	if !r.lifecycle.Contains(windowName) {
		return fmt.Errorf("app window %q is not live", windowName)
	}
	r.authorizeClose(windowName)
	if r.closeWindow(windowName) {
		return nil
	}
	r.consumeAuthorizedClose(windowName)
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
		if pending.timeout != nil {
			pending.timeout.Stop()
		}
		r.pendingQuit = nil
		r.setQuitApprovedLocked(false)
		r.quitMu.Unlock()
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
	r.pendingQuit = nil
	r.setQuitApprovedLocked(true)
	r.quitMu.Unlock()

	return r.closeApprovedApplicationWindows()
}

func (r *Registry) closeApprovedApplicationWindows() error {
	for _, panelName := range r.panels.Names("") {
		if err := r.AcknowledgePanelWindowClose(panelName); err != nil {
			return err
		}
	}
	for _, workspaceName := range r.lifecycle.Names() {
		if err := r.AcknowledgeWorkspaceWindowClose(workspaceName); err != nil {
			return err
		}
	}

	return nil
}

func (r *Registry) handleClosing(event *application.WindowEvent, name string) {
	if !r.consumeAuthorizedClose(name) && r.isWorkspaceReady(name) {
		if event != nil {
			event.Cancel()
		}
		r.emitWindowEvent(name, panelwindow.WorkspaceCloseRequestedEventName, panelwindow.WorkspaceCloseRequestedEvent{WindowName: name})
		return
	}
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
	r.forgetWorkspaceReady(name)
	r.workspace.RetainWindow(name)
	r.failPanelTabTransfersForWindow(name, "app window closed during tab transfer")
	if remaining > 0 || len(r.panels.Names("")) > 0 {
		r.backend.ReleaseWorkspaceWindow(name)
		return
	}
	if r.backend.PrepareQuitFromWindow(name) {
		return
	}
	r.quitMu.Lock()
	r.setQuitApprovedLocked(false)
	r.quitMu.Unlock()
	r.lifecycle.CancelClose(name)
	if event != nil {
		event.Cancel()
	}
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
	name := r.lifecycle.MostRecent()
	window, ok := r.application.Window.GetByName(name)
	if !ok {
		return
	}
	window.Show()
	if window.IsMinimised() {
		window.Restore()
	}
	window.Focus()
}

func (r *Registry) readyWorkspaceNames() []string {
	ready := make([]string, 0)
	for _, name := range r.lifecycle.Names() {
		if r.isWorkspaceReady(name) {
			ready = append(ready, name)
		}
	}
	for _, name := range r.panels.Names("") {
		if r.panels.State(name) == PanelWindowStateLive {
			ready = append(ready, name)
		}
	}
	return ready
}

func (r *Registry) expireApplicationQuitPreflight(pending *applicationQuitPreflight) {
	r.quitMu.Lock()
	defer r.quitMu.Unlock()
	if r.pendingQuit == pending {
		r.pendingQuit = nil
	}
}

func (r *Registry) cancelApplicationQuitPreflight(pending *applicationQuitPreflight) {
	r.quitMu.Lock()
	defer r.quitMu.Unlock()
	if r.pendingQuit != pending {
		return
	}
	if pending.timeout != nil {
		pending.timeout.Stop()
	}
	r.pendingQuit = nil
}

func (r *Registry) beginApplicationQuitPreflightLocked(
	readyWorkspaces []string,
) *applicationQuitPreflight {
	r.nextQuit++
	pending := &applicationQuitPreflight{
		transactionID: fmt.Sprintf("application-quit-%d", r.nextQuit),
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
			TransactionID: pending.transactionID,
			WindowName:    workspaceName,
		}) {
			r.cancelApplicationQuitPreflight(pending)
			return
		}
	}
}

func (r *Registry) finishApprovedApplicationQuitLocked() bool {
	if r.lifecycle.Count() > 0 || len(r.panels.Names("")) > 0 {
		r.quitMu.Unlock()
		return false
	}
	r.setQuitApprovedLocked(false)
	mostRecent := r.lifecycle.MostRecent()
	r.quitMu.Unlock()
	return r.backend.PrepareQuitFromWindow(mostRecent)
}

// PrepareApplicationQuit performs the shared last-window quit preparation.
func (r *Registry) PrepareApplicationQuit() bool {
	if r == nil || r.backend == nil || r.lifecycle == nil {
		return true
	}
	r.quitMu.Lock()
	if r.quitApproved {
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
	backgroundType := application.BackgroundTypeTransparent
	if goos == "windows" {
		backgroundType = application.BackgroundTypeSolid
	}
	windowTitle := ""
	if goos == "linux" {
		// Wails substitutes Name when Title is empty on initial Linux creation.
		// A space prevents that fallback until the native title is cleared.
		windowTitle = " "
	}

	options := application.WebviewWindowOptions{
		Name:             name,
		Title:            windowTitle,
		Width:            500,
		Height:           400,
		MinWidth:         450,
		MinHeight:        200,
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
		Hidden:             true,
	}
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
	backgroundType := application.BackgroundTypeTransparent
	if goos == "windows" {
		backgroundType = application.BackgroundTypeSolid
	}

	return application.WebviewWindowOptions{
		Name:             name,
		Title:            "Luxury Yacht",
		Width:            1200,
		Height:           800,
		MinWidth:         1100,
		MinHeight:        600,
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
		Hidden:             goos != "linux",
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
	event := panelwindow.WindowTransferFailedEvent{WindowName: descriptor.WindowName, TransferID: descriptor.Snapshot.TransferID, ClusterID: descriptor.ClusterID}
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
