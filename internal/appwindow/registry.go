package appwindow

import (
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
}

// Registry owns the application's peer workspace windows and their lifecycle.
type Registry struct {
	application          *application.App
	backend              lifecycleBackend
	menu                 *application.Menu
	lifecycle            *lifecycle
	panels               *panelIndex
	newWindow            func(application.WebviewWindowOptions) *application.WebviewWindow
	showWindow           func(string) bool
	closeWindow          func(string) bool
	focusWindow          func(string) bool
	emitWindowEvent      func(string, string, any) bool
	windowGeometry       func(string) (geometry, bool)
	closeMu              sync.Mutex
	authorizedClose      map[string]struct{}
	workspaceReady       map[string]struct{}
	panelOpenTimeout     time.Duration
	quitMu               sync.Mutex
	nextQuit             uint64
	pendingQuit          *applicationQuitPreflight
	quitApproved         bool
	quitApprovalTimeout  *time.Timer
	quitPreflightTimeout time.Duration
	guardMu              sync.Mutex
	pendingGuards        map[string]panelGuardRequest
}

type applicationQuitPreflight struct {
	transactionID string
	waiting       map[string]struct{}
	timeout       *time.Timer
}

type panelGuardRequest struct {
	ownerWindowName string
	panelWindowName string
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
	menu *application.Menu,
) *Registry {
	registry := &Registry{
		application:          app,
		backend:              backend,
		menu:                 menu,
		lifecycle:            newLifecycle(),
		panels:               newPanelIndex(),
		authorizedClose:      make(map[string]struct{}),
		workspaceReady:       make(map[string]struct{}),
		panelOpenTimeout:     15 * time.Second,
		quitPreflightTimeout: 20 * time.Second,
		pendingGuards:        make(map[string]panelGuardRequest),
	}
	bindApplicationWindowOperations(registry, app)
	return registry
}

// BeginPanelWindowOpen records a pending handoff and creates its hidden native
// target. The caller keeps rendering the source until the transfer is acknowledged.
func (r *Registry) BeginPanelWindowOpen(
	snapshot PanelGroupSnapshot,
) (PanelWindowDescriptor, error) {
	if r == nil || r.lifecycle == nil || !r.lifecycle.Contains(snapshot.OwnerWindowName) {
		return PanelWindowDescriptor{}, fmt.Errorf(
			"owner workspace %q is not live",
			snapshot.OwnerWindowName,
		)
	}
	descriptor, err := r.panels.BeginOpen(snapshot)
	if err != nil {
		return PanelWindowDescriptor{}, err
	}
	options := panelWindowOptions(descriptor.WindowName, r.menu, snapshot.InitialBounds)
	if snapshot.InitialBounds != nil {
		positioned := false
		if r.windowGeometry != nil {
			if ownerGeometry, ok := r.windowGeometry(snapshot.OwnerWindowName); ok {
				positioned = positionPanelWindowOptions(&options, ownerGeometry)
			}
		}
		if !positioned {
			options.InitialPosition = application.WindowCentered
		}
	}
	window := r.newWindow(options)
	if window == nil {
		_ = r.panels.FailTransfer(descriptor.WindowName, snapshot.TransferID)
		return PanelWindowDescriptor{}, fmt.Errorf(
			"create native panel window %q",
			descriptor.WindowName,
		)
	}
	r.registerPanelLifecycleHooks(window, descriptor.WindowName)
	if r.panelOpenTimeout > 0 {
		time.AfterFunc(r.panelOpenTimeout, func() {
			r.expirePanelOpen(descriptor.WindowName, snapshot.TransferID)
		})
	}
	return descriptor, nil
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
	options := windowOptions(name, r.menu)
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

// PanelNamesOwnedByWorkspace lists the current process-local native children
// of one workspace.
func (r *Registry) PanelNamesOwnedByWorkspace(ownerWindowName string) []string {
	if r == nil || r.panels == nil {
		return nil
	}
	return r.panels.NamesOwnedBy(ownerWindowName, "")
}

// AcknowledgePanelWindowReady commits an opening transfer and reveals the
// hidden native target. A stale acknowledgement leaves the source transfer pending.
func (r *Registry) AcknowledgePanelWindowReady(
	name, transferID string,
) (PanelWindowDescriptor, error) {
	descriptor, err := r.panels.AcknowledgeOpen(name, transferID)
	if err != nil {
		return PanelWindowDescriptor{}, err
	}
	if r.showWindow(name) {
		if r.emitWindowEvent(descriptor.OwnerWindowName, panelwindow.WindowOpenedEventName, panelwindow.WindowOpenedEvent{
			WindowName: descriptor.WindowName,
			TransferID: descriptor.Snapshot.TransferID,
			ClusterID:  descriptor.ClusterID,
			GroupID:    descriptor.GroupID,
			Snapshot:   descriptor.Snapshot,
		}) {
			return descriptor, nil
		}
		r.authorizeClose(name)
		if !r.closeWindow(name) {
			r.consumeAuthorizedClose(name)
		}
		r.panels.Remove(name)
		r.emitPanelClosed(descriptor)
		return PanelWindowDescriptor{}, fmt.Errorf(
			"owner workspace %q is not available for panel open",
			descriptor.OwnerWindowName,
		)
	}
	r.panels.Remove(name)
	r.emitPanelClosed(descriptor)
	return PanelWindowDescriptor{}, fmt.Errorf("panel window %q disappeared before ready", name)
}

func (r *Registry) emitPanelClosed(descriptor PanelWindowDescriptor) {
	r.emitWindowEvent(descriptor.OwnerWindowName, panelwindow.WindowClosedEventName, panelwindow.WindowClosedEvent{
		WindowName: descriptor.WindowName,
		ClusterID:  descriptor.ClusterID,
		GroupID:    descriptor.GroupID,
	})
}

// BeginPanelWindowDock records a target handoff while the native source stays
// live, then routes the complete snapshot to its immutable owner workspace.
func (r *Registry) BeginPanelWindowDock(
	windowName string,
	targetPosition string,
	snapshot PanelGroupSnapshot,
) error {
	if targetPosition != "right" && targetPosition != "bottom" {
		return fmt.Errorf("unsupported panel dock position %q", targetPosition)
	}
	if err := r.panels.BeginDock(windowName, snapshot); err != nil {
		return err
	}
	descriptor, err := r.panels.Descriptor(windowName)
	if err != nil {
		_ = r.panels.FailTransfer(windowName, snapshot.TransferID)
		return err
	}
	if !r.emitWindowEvent(descriptor.OwnerWindowName, panelwindow.WindowDockRequestedEventName, panelwindow.WindowDockRequestedEvent{
		WindowName:     windowName,
		TransferID:     snapshot.TransferID,
		TargetPosition: targetPosition,
		Snapshot:       snapshot,
	}) {
		_ = r.panels.FailTransfer(windowName, snapshot.TransferID)
		return fmt.Errorf("owner workspace %q is not available", descriptor.OwnerWindowName)
	}
	return nil
}

// AcknowledgePanelWindowDock commits the owner's reconstructed docked target,
// removes the native role, and closes the now-redundant source window.
func (r *Registry) AcknowledgePanelWindowDock(
	ownerWindowName, windowName, transferID string,
) error {
	descriptor, err := r.panels.Descriptor(windowName)
	if err != nil {
		return err
	}
	if descriptor.OwnerWindowName != ownerWindowName {
		return fmt.Errorf(
			"panel window %q is owned by %q, not %q",
			windowName,
			descriptor.OwnerWindowName,
			ownerWindowName,
		)
	}
	if err := r.panels.ValidateDock(windowName, transferID); err != nil {
		return err
	}
	r.authorizeClose(windowName)
	if !r.closeWindow(windowName) {
		r.consumeAuthorizedClose(windowName)
		_ = r.panels.FailTransfer(windowName, transferID)
		return fmt.Errorf("panel window %q is not available for dock commit", windowName)
	}
	if err := r.panels.AcknowledgeDock(windowName, transferID); err != nil {
		r.consumeAuthorizedClose(windowName)
		return err
	}
	return nil
}

func (r *Registry) FailPanelWindowTransfer(callerWindowName, windowName, transferID string) error {
	descriptor, err := r.panels.Descriptor(windowName)
	if err != nil {
		return err
	}
	if callerWindowName != windowName && callerWindowName != descriptor.OwnerWindowName {
		return fmt.Errorf("window %q cannot fail panel transfer for %q", callerWindowName, windowName)
	}
	wasOpening := descriptor.State == PanelWindowStateOpening
	if err := r.panels.FailTransfer(windowName, transferID); err != nil {
		return err
	}
	if !wasOpening {
		return nil
	}
	r.authorizeClose(windowName)
	if !r.closeWindow(windowName) {
		r.consumeAuthorizedClose(windowName)
		r.emitPanelClosed(descriptor)
		return fmt.Errorf("panel window %q is not available", windowName)
	}
	r.emitPanelClosed(descriptor)
	return nil
}

func (r *Registry) FocusPanelWindow(ownerWindowName, windowName string, panelID string) error {
	descriptor, err := r.panels.Descriptor(windowName)
	if err != nil {
		return err
	}
	if descriptor.OwnerWindowName != ownerWindowName {
		return fmt.Errorf("panel window %q is not owned by %q", windowName, ownerWindowName)
	}
	if !r.emitWindowEvent(windowName, panelwindow.WindowFocusRequestedEventName, panelwindow.WindowFocusRequestedEvent{PanelID: panelID}) || !r.focusWindow(windowName) {
		return fmt.Errorf("panel window %q is not available", windowName)
	}
	return nil
}

var ownerRoutedPanelCommands = map[string]struct{}{
	"open-about": {}, "open-cluster": {}, "open-command-palette": {}, "open-settings": {},
	"toggle-app-logs-panel": {}, "toggle-diagnostics": {}, "toggle-object-diff": {}, "toggle-sidebar": {},
}

func (r *Registry) RoutePanelWindowCommand(windowName, eventName string) error {
	if _, allowed := ownerRoutedPanelCommands[eventName]; !allowed {
		return fmt.Errorf("panel command %q cannot be routed", eventName)
	}
	descriptor, err := r.panels.Descriptor(windowName)
	if err != nil {
		return err
	}
	if !r.focusWindow(descriptor.OwnerWindowName) {
		return fmt.Errorf("owner workspace %q is not available", descriptor.OwnerWindowName)
	}
	if !r.emitWindowEvent(descriptor.OwnerWindowName, eventName, nil) {
		return fmt.Errorf("owner workspace %q is not available", descriptor.OwnerWindowName)
	}
	return nil
}

func (r *Registry) RequestPanelObjectOpen(
	windowName string,
	ref PanelObjectReference,
	activeView string,
) error {
	if err := panelwindow.ValidateObjectReference(ref); err != nil {
		return err
	}
	if activeView == "" {
		return fmt.Errorf("panel object open requires an active view")
	}
	descriptor, err := r.panels.Descriptor(windowName)
	if err != nil {
		return err
	}
	if !r.emitWindowEvent(
		descriptor.OwnerWindowName,
		panelwindow.ObjectOpenRequestedEventName,
		panelwindow.ObjectOpenRequestEvent{
			SourceWindowName: windowName,
			OwnerWindowName:  descriptor.OwnerWindowName,
			ClusterID:        descriptor.ClusterID,
			GroupID:          descriptor.GroupID,
			ObjectRef:        ref,
			ActiveView:       activeView,
		},
	) {
		return fmt.Errorf("owner workspace %q is not available", descriptor.OwnerWindowName)
	}
	return nil
}

func (r *Registry) AuthorizePanelObjectOpen(
	ownerWindowName string,
	windowName string,
	panelID string,
	ref PanelObjectReference,
	activeView string,
) error {
	if err := panelwindow.ValidateObjectReference(ref); err != nil {
		return err
	}
	descriptor, err := r.panels.Descriptor(windowName)
	if err != nil {
		return err
	}
	if descriptor.OwnerWindowName != ownerWindowName || descriptor.ClusterID != ref.ClusterID {
		return fmt.Errorf("panel object authorization does not match owner and cluster")
	}
	if !r.emitWindowEvent(
		windowName,
		panelwindow.ObjectOpenAuthorizedEventName,
		panelwindow.ObjectOpenAuthorizedEvent{
			PanelID: panelID, ObjectRef: ref, ActiveView: activeView,
		},
	) {
		return fmt.Errorf("panel window %q is not available", windowName)
	}
	return nil
}

func (r *Registry) UpdatePanelWindowSnapshot(windowName string, snapshot PanelGroupSnapshot) error {
	if err := r.panels.UpdateSnapshot(windowName, snapshot); err != nil {
		return err
	}
	descriptor, err := r.panels.Descriptor(windowName)
	if err != nil {
		return err
	}
	if !r.emitWindowEvent(
		descriptor.OwnerWindowName,
		panelwindow.SnapshotUpdatedEventName,
		panelwindow.SnapshotUpdatedEvent{WindowName: windowName, Snapshot: descriptor.Snapshot},
	) {
		return fmt.Errorf("owner workspace %q is not available", descriptor.OwnerWindowName)
	}
	return nil
}

func (r *Registry) RequestPanelTabClose(windowName, panelID string) error {
	descriptor, err := r.panels.Descriptor(windowName)
	if err != nil {
		return err
	}
	found := false
	for _, tab := range descriptor.Snapshot.Tabs {
		if tab.PanelID == panelID {
			found = true
			break
		}
	}
	if !found {
		return fmt.Errorf("panel %q is not owned by window %q", panelID, windowName)
	}
	if !r.emitWindowEvent(
		descriptor.OwnerWindowName,
		panelwindow.TabCloseRequestedEventName,
		panelwindow.TabCloseRequestedEvent{
			SourceWindowName: windowName,
			OwnerWindowName:  descriptor.OwnerWindowName,
			ClusterID:        descriptor.ClusterID,
			GroupID:          descriptor.GroupID,
			PanelID:          panelID,
		},
	) {
		return fmt.Errorf("owner workspace %q is not available", descriptor.OwnerWindowName)
	}
	return nil
}

func (r *Registry) AuthorizePanelTabClose(ownerWindowName, windowName, panelID string) error {
	descriptor, err := r.panels.Descriptor(windowName)
	if err != nil {
		return err
	}
	if descriptor.OwnerWindowName != ownerWindowName {
		return fmt.Errorf("panel window %q is not owned by %q", windowName, ownerWindowName)
	}
	if !r.emitWindowEvent(
		windowName,
		panelwindow.TabCloseAuthorizedEventName,
		panelwindow.TabCloseAuthorizedEvent{PanelID: panelID},
	) {
		return fmt.Errorf("panel window %q is not available", windowName)
	}
	return nil
}

// RequestPanelWindowClose validates the owner relationship and asks the child
// to run its local group guards before authorizing native destruction.
func (r *Registry) RequestPanelWindowClose(callerWindowName, windowName, reason string) error {
	descriptor, err := r.panels.Descriptor(windowName)
	if err != nil {
		return err
	}
	if callerWindowName != windowName && callerWindowName != descriptor.OwnerWindowName {
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

func (r *Registry) RequestPanelWindowGuard(
	ownerWindowName, windowName, requestID, reason string,
) error {
	if requestID == "" || reason == "" {
		return fmt.Errorf("panel guard request requires request and reason")
	}
	descriptor, err := r.panels.Descriptor(windowName)
	if err != nil {
		return err
	}
	if descriptor.OwnerWindowName != ownerWindowName {
		return fmt.Errorf("panel window %q is not owned by %q", windowName, ownerWindowName)
	}
	r.guardMu.Lock()
	if _, exists := r.pendingGuards[requestID]; exists {
		r.guardMu.Unlock()
		return fmt.Errorf("panel guard request %q already exists", requestID)
	}
	r.pendingGuards[requestID] = panelGuardRequest{
		ownerWindowName: ownerWindowName,
		panelWindowName: windowName,
	}
	r.guardMu.Unlock()
	if r.emitWindowEvent(windowName, panelwindow.WindowGuardRequestedEventName, panelwindow.WindowGuardRequestedEvent{
		RequestID:  requestID,
		WindowName: windowName,
		Reason:     reason,
	}) {
		return nil
	}
	r.guardMu.Lock()
	delete(r.pendingGuards, requestID)
	r.guardMu.Unlock()
	return fmt.Errorf("panel window %q is not available", windowName)
}

func (r *Registry) AcknowledgePanelWindowGuard(
	windowName string,
	requestID string,
	allowed bool,
) error {
	r.guardMu.Lock()
	request, exists := r.pendingGuards[requestID]
	if !exists || request.panelWindowName != windowName {
		r.guardMu.Unlock()
		return fmt.Errorf("stale panel guard request %q", requestID)
	}
	delete(r.pendingGuards, requestID)
	r.guardMu.Unlock()
	if !r.emitWindowEvent(request.ownerWindowName, panelwindow.WindowGuardResultEventName, panelwindow.WindowGuardResultEvent{
		RequestID:  requestID,
		WindowName: windowName,
		Allowed:    allowed,
	}) {
		return fmt.Errorf("owner workspace %q is not available", request.ownerWindowName)
	}
	return nil
}

func (r *Registry) forgetPanelGuardsForOwner(ownerWindowName string) {
	r.guardMu.Lock()
	defer r.guardMu.Unlock()
	for requestID, request := range r.pendingGuards {
		if request.ownerWindowName == ownerWindowName {
			delete(r.pendingGuards, requestID)
		}
	}
}

// AcknowledgePanelWindowClose is called only after the child has passed every
// tab guard and the owner has removed the corresponding directory entries.
func (r *Registry) AcknowledgePanelWindowClose(windowName string) error {
	descriptor, err := r.panels.Descriptor(windowName)
	if err != nil {
		return err
	}
	r.authorizeClose(windowName)
	if !r.closeWindow(windowName) {
		r.consumeAuthorizedClose(windowName)
		return fmt.Errorf("panel window %q is not available", windowName)
	}
	r.panels.Remove(windowName)
	r.emitPanelClosed(descriptor)
	return nil
}

func (r *Registry) AcknowledgeWorkspaceWindowClose(ownerWindowName string) error {
	if names := r.PanelNamesOwnedByWorkspace(ownerWindowName); len(names) > 0 {
		return fmt.Errorf("owner workspace %q still has live panel windows", ownerWindowName)
	}
	r.authorizeClose(ownerWindowName)
	if r.closeWindow(ownerWindowName) {
		return nil
	}
	r.consumeAuthorizedClose(ownerWindowName)
	return fmt.Errorf("owner workspace %q is not available", ownerWindowName)
}

func (r *Registry) AcknowledgeApplicationQuitPreflight(
	ownerWindowName string,
	transactionID string,
	allowed bool,
) error {
	r.quitMu.Lock()
	pending := r.pendingQuit
	if pending == nil || pending.transactionID != transactionID {
		r.quitMu.Unlock()
		return fmt.Errorf("stale application quit transaction %q", transactionID)
	}
	if _, waiting := pending.waiting[ownerWindowName]; !waiting {
		r.quitMu.Unlock()
		return fmt.Errorf("workspace %q is not awaiting application quit preflight", ownerWindowName)
	}
	if !allowed {
		if pending.timeout != nil {
			pending.timeout.Stop()
		}
		r.pendingQuit = nil
		r.setQuitApprovedLocked(false)
		r.quitMu.Unlock()
		r.forgetPanelGuardsForOwner(ownerWindowName)
		return nil
	}
	delete(pending.waiting, ownerWindowName)
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

	for _, workspaceName := range r.lifecycle.Names() {
		if !r.emitWindowEvent(workspaceName, panelwindow.OwnerCloseRequestedEventName, panelwindow.OwnerCloseRequestedEvent{
			OwnerWindowName: workspaceName,
			PanelWindows:    r.PanelNamesOwnedByWorkspace(workspaceName),
		}) {
			r.quitMu.Lock()
			r.setQuitApprovedLocked(false)
			r.quitMu.Unlock()
			return fmt.Errorf("workspace %q is not available for application quit", workspaceName)
		}
	}
	return nil
}

func (r *Registry) handleClosing(event *application.WindowEvent, name string) {
	if !r.consumeAuthorizedClose(name) {
		if r.isWorkspaceReady(name) {
			panelNames := r.PanelNamesOwnedByWorkspace(name)
			if event != nil {
				event.Cancel()
			}
			r.emitWindowEvent(name, panelwindow.OwnerCloseRequestedEventName, panelwindow.OwnerCloseRequestedEvent{
				OwnerWindowName: name,
				PanelWindows:    panelNames,
			})
			return
		}
	}
	remaining, tracked := r.lifecycle.BeginClose(name)
	if !tracked {
		return
	}
	r.forgetWorkspaceReady(name)
	if remaining > 0 {
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
	event.Cancel()
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
	readyWorkspaces := make([]string, 0, r.lifecycle.Count())
	for _, workspaceName := range r.lifecycle.Names() {
		if r.isWorkspaceReady(workspaceName) {
			readyWorkspaces = append(readyWorkspaces, workspaceName)
		}
	}
	return readyWorkspaces
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
			TransactionID:   pending.transactionID,
			OwnerWindowName: workspaceName,
			PanelWindows:    r.PanelNamesOwnedByWorkspace(workspaceName),
		}) {
			r.cancelApplicationQuitPreflight(pending)
			return
		}
	}
}

func (r *Registry) finishApprovedApplicationQuitLocked() bool {
	if r.lifecycle.Count() > 0 {
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

func windowOptions(name string, nativeMenu *application.Menu) application.WebviewWindowOptions {
	return windowOptionsForPlatform(name, nativeMenu, runtime.GOOS)
}

func panelWindowOptions(
	name string,
	nativeMenu *application.Menu,
	initialBounds *panelwindow.WindowBounds,
) application.WebviewWindowOptions {
	return panelWindowOptionsForPlatform(name, nativeMenu, runtime.GOOS, initialBounds)
}

func panelWindowOptionsForPlatform(
	name string,
	nativeMenu *application.Menu,
	goos string,
	initialBounds *panelwindow.WindowBounds,
) application.WebviewWindowOptions {
	backgroundType := application.BackgroundTypeTransparent
	if goos == "windows" {
		backgroundType = application.BackgroundTypeSolid
	}

	options := application.WebviewWindowOptions{
		Name:               name,
		Width:              500,
		Height:             400,
		MinWidth:           450,
		MinHeight:          200,
		URL:                "/",
		BackgroundColour:   application.NewRGB(30, 30, 30),
		BackgroundType:     backgroundType,
		Mac:                sharedMacWindowChrome(),
		Windows:            application.WindowsWindow{Theme: application.SystemDefault},
		Linux:              application.LinuxWindow{Menu: nativeMenu},
		UseApplicationMenu: true,
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

func constrainPanelWindowOptions(options *application.WebviewWindowOptions, workArea application.Rect) {
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
		constrainPanelWindowOptions(options, owner.Screen.WorkArea)
	}
	return true
}

func windowOptionsForPlatform(name string, nativeMenu *application.Menu, goos string) application.WebviewWindowOptions {
	backgroundType := application.BackgroundTypeTransparent
	if goos == "windows" {
		backgroundType = application.BackgroundTypeSolid
	}

	return application.WebviewWindowOptions{
		Name:               name,
		Title:              "Luxury Yacht",
		Width:              1200,
		Height:             800,
		MinWidth:           1100,
		MinHeight:          600,
		URL:                "/",
		BackgroundColour:   application.NewRGB(30, 30, 30),
		BackgroundType:     backgroundType,
		Mac:                sharedMacWindowChrome(),
		Windows:            application.WindowsWindow{Theme: application.SystemDefault},
		Linux:              application.LinuxWindow{Menu: nativeMenu},
		UseApplicationMenu: true,
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
