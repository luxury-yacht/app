package appwindow

import (
	"fmt"

	"github.com/luxury-yacht/app/internal/panelwindow"
)

type panelTabTransfer struct {
	request          panelwindow.TabTransferRequest
	targetWindowName string
	// release cancels the directory move begun at acceptance. Every tab transfer
	// ends in removePanelTabTransferLocked, so a failed move cannot pin its panel.
	release func()
}

func samePanelTab(left, right panelwindow.TabSnapshot) bool {
	return left == right
}

// A fast check before any target is resolved or created. The directory repeats
// it authoritatively when the source accepts; the dragged view need not have
// been published.
func (r *Registry) validatePanelTabTransferSource(request panelwindow.TabTransferRequest) error {
	if !r.windowHasCluster(request.SourceWindowName, request.ClusterID) {
		return fmt.Errorf("source window does not display the transfer cluster")
	}
	for _, panel := range r.workspace.Snapshot(request.ClusterID).Panels {
		if panel.Tab.SameIdentity(request.Tab) && panel.Location.WindowName == request.SourceWindowName {
			return nil
		}
	}
	return fmt.Errorf("panel transfer source is stale or does not contain the requested tab")
}

func (r *Registry) validatePanelTabTransferTarget(request panelwindow.TabTransferRequest) error {
	switch request.TargetKind {
	case panelwindow.TabTransferTargetWorkspace:
		if r.lifecycle == nil || !r.lifecycle.Contains(request.TargetWindowName) || !r.windowHasCluster(request.TargetWindowName, request.ClusterID) {
			return fmt.Errorf("target workspace %q is not live", request.TargetWindowName)
		}
	case panelwindow.TabTransferTargetPanelWindow:
		descriptor, err := r.panels.Descriptor(request.TargetWindowName)
		if err != nil {
			return err
		}
		if descriptor.State != PanelWindowStateLive ||
			descriptor.ClusterID != request.ClusterID ||
			descriptor.GroupID != request.TargetGroupID {
			return fmt.Errorf("panel tab transfer target does not match owner and cluster identity")
		}
		if request.TargetWindowName == request.SourceWindowName {
			return fmt.Errorf("panel tab transfer target must differ from its source window")
		}
	case panelwindow.TabTransferTargetNewWindow:
		// The owner creates and acknowledges this target after accepting the request.
	default:
		return fmt.Errorf("unsupported panel tab transfer target %q", request.TargetKind)
	}
	return nil
}

func (r *Registry) resetPanelTabTransferTimeoutLocked(transfer *panelTabTransfer) {
	transferID := transfer.request.TransferID
	r.tabTransfers.setTimeout(transferID, r.tabTransferTimeout, func() {
		r.failPanelTabTransfer(transferID, "panel tab transfer timed out")
	})
}

func (r *Registry) RequestPanelTabTransfer(
	callerWindowName string,
	request panelwindow.TabTransferRequest,
) error {
	if err := panelwindow.ValidateTabTransferRequest(request); err != nil {
		return err
	}
	expectedCaller := request.TargetWindowName
	if request.TargetWindowName == "" {
		expectedCaller = request.SourceWindowName
	}
	if callerWindowName != expectedCaller {
		return fmt.Errorf("window %q cannot request panel tab transfer %q", callerWindowName, request.TransferID)
	}
	if err := r.validatePanelTabTransferSource(request); err != nil {
		return err
	}
	var err error
	request, err = r.resolvePanelTabDockTarget(request)
	if err != nil {
		return err
	}
	if err := r.validatePanelTabTransferTarget(request); err != nil {
		return err
	}

	r.tabTransferMu.Lock()
	transfer, err := r.reservePanelTabTransferLocked(request)
	if err == nil {
		r.resetPanelTabTransferTimeoutLocked(transfer)
	}
	r.tabTransferMu.Unlock()
	if err != nil {
		return err
	}

	if r.emitWindowEvent(
		request.SourceWindowName,
		panelwindow.TabTransferRequestedEventName,
		panelwindow.TabTransferRequestedEvent{Request: request},
	) {
		return nil
	}
	r.removePanelTabTransfer(request.TransferID)
	return fmt.Errorf("source app window %q is not available", request.SourceWindowName)
}

func (r *Registry) reservePanelTabTransferLocked(request panelwindow.TabTransferRequest) (*panelTabTransfer, error) {
	if r.tabTransfers.wasUsed(request.TransferID) {
		return nil, fmt.Errorf("panel tab transfer %q already exists", request.TransferID)
	}
	for _, pending := range r.tabTransfers.all() {
		if pending.request.ClusterID == request.ClusterID &&
			pending.request.SourceWindowName == request.SourceWindowName &&
			pending.request.Tab.PanelID == request.Tab.PanelID {
			return nil, fmt.Errorf("panel tab %q already has a pending transfer", request.Tab.PanelID)
		}
	}
	transfer := &panelTabTransfer{request: request}
	if err := r.tabTransfers.begin(request.TransferID, transfer, transferAwaitingSource); err != nil {
		return nil, err
	}
	return transfer, nil
}

func (r *Registry) AcceptPanelTabTransfer(callerWindowName, transferID string) error {
	r.tabTransferMu.Lock()
	transfer := r.tabTransfers.get(transferID)
	if !r.tabTransfers.awaiting(transferID, transferAwaitingSource) {
		r.tabTransferMu.Unlock()
		return fmt.Errorf("stale panel tab transfer %q", transferID)
	}
	request := transfer.request
	if request.SourceWindowName != callerWindowName {
		r.tabTransferMu.Unlock()
		return fmt.Errorf("panel tab transfer %q is not owned by %q", transferID, callerWindowName)
	}
	if err := r.beginPanelTabPlacementLocked(transfer); err != nil {
		r.tabTransferMu.Unlock()
		r.failPanelTabTransfer(transferID, err.Error())
		return err
	}
	r.tabTransfers.accept(transferID)
	r.resetPanelTabTransferTimeoutLocked(transfer)
	r.tabTransferMu.Unlock()
	return r.deliverPanelTabTransfer(request)
}

// A tear-off's directory move belongs to the new window's open transfer; every
// other target gets a one-tab directory move tied to this transfer's terminal.
func (r *Registry) beginPanelTabPlacementLocked(transfer *panelTabTransfer) error {
	request := transfer.request
	if request.TargetKind == panelwindow.TabTransferTargetNewWindow {
		return nil
	}
	kind := panelwindow.PanelLocationWindow
	if request.TargetKind == panelwindow.TabTransferTargetWorkspace {
		kind = panelwindow.PanelLocationDocked
	}
	if err := r.workspace.BeginGroupTransfer(panelwindow.GroupTransfer{
		TransferID:   request.TransferID,
		SourceWindow: request.SourceWindowName,
		Target:       panelwindow.PanelLocation{Kind: kind, WindowName: request.TargetWindowName, GroupID: request.TargetGroupID, Index: request.TargetIndex},
		Group:        panelwindow.WorkspaceGroup{ClusterID: request.ClusterID, Tabs: []panelwindow.TabSnapshot{request.Tab}, ActivePanelID: request.Tab.PanelID},
	}); err != nil {
		return err
	}
	directory := r.workspace
	transfer.release = func() { directory.CancelGroupTransfer(request.TransferID) }
	return nil
}

// App views learn of the move from their next directory read; a live native
// target, which reads no directory, receives the request itself.
func (r *Registry) deliverPanelTabTransfer(request panelwindow.TabTransferRequest) error {
	switch request.TargetKind {
	case panelwindow.TabTransferTargetNewWindow:
		return nil
	case panelwindow.TabTransferTargetWorkspace:
		r.emitWorkspaceChanged(request.ClusterID)
		return nil
	}
	if r.emitWindowEvent(
		request.TargetWindowName,
		panelwindow.TabTransferInsertRequestedEventName,
		panelwindow.TabTransferInsertRequestedEvent{Request: request},
	) {
		return nil
	}
	r.failPanelTabTransfer(request.TransferID, "target panel window is not available")
	return fmt.Errorf("target panel window %q is not available", request.TargetWindowName)
}

func (r *Registry) hasPanelTabTransfer(transferID string) bool {
	r.tabTransferMu.Lock()
	defer r.tabTransferMu.Unlock()
	return r.tabTransfers.get(transferID) != nil
}

// settlePanelTabTransfer commits the directory move once its target shows the
// tab, or cancels it so the source keeps the tab.
func (r *Registry) settlePanelTabTransfer(targetWindow, transferID string, mounted bool) error {
	r.tabTransferMu.Lock()
	transfer := r.tabTransfers.get(transferID)
	if transfer == nil || !r.tabTransfers.awaiting(transferID, transferAwaitingTarget) ||
		transfer.request.TargetKind == panelwindow.TabTransferTargetNewWindow ||
		transfer.request.TargetWindowName != targetWindow {
		r.tabTransferMu.Unlock()
		return fmt.Errorf("window %q cannot settle panel tab transfer %q", targetWindow, transferID)
	}
	request := transfer.request
	if !mounted {
		r.tabTransferMu.Unlock()
		r.failPanelTabTransfer(transferID, "panel tab transfer target rejected the panel")
		return nil
	}
	if err := r.workspace.CommitGroupTransfer(transferID); err != nil {
		r.tabTransferMu.Unlock()
		r.failPanelTabTransfer(transferID, err.Error())
		return err
	}
	r.removePanelTabTransferLocked(transferID)
	r.tabTransferMu.Unlock()
	r.emitPanelTabTransferEvent(request, panelwindow.TabTransferCommittedEventName, panelwindow.TabTransferCommittedEvent{Request: request})
	r.emitWorkspaceChanged(request.ClusterID)
	return nil
}

func (r *Registry) resolvePanelTabDockTarget(request panelwindow.TabTransferRequest) (panelwindow.TabTransferRequest, error) {
	if request.TargetKind != panelwindow.TabTransferTargetWorkspace || request.TargetWindowName != "" {
		return request, nil
	}
	target, err := r.appWindowForCluster(request.ClusterID, request.SourceWindowName)
	if err != nil {
		return request, err
	}
	request.TargetWindowName = target
	request.TargetIndex = 0
	for _, panel := range r.workspace.Snapshot(request.ClusterID).Panels {
		if panel.Location.WindowName == target && panel.Location.GroupID == request.TargetGroupID {
			request.TargetIndex++
		}
	}
	return request, nil
}

func (r *Registry) FailPanelTabTransfer(callerWindowName, transferID string) error {
	r.tabTransferMu.Lock()
	transfer := r.tabTransfers.get(transferID)
	if transfer == nil {
		r.tabTransferMu.Unlock()
		return fmt.Errorf("stale panel tab transfer %q", transferID)
	}
	request := transfer.request
	allowed := callerWindowName == request.SourceWindowName ||
		callerWindowName == request.TargetWindowName
	r.tabTransferMu.Unlock()
	if !allowed {
		return fmt.Errorf("window %q cannot fail panel tab transfer %q", callerWindowName, transferID)
	}
	r.failPanelTabTransfer(transferID, "panel tab transfer failed")
	return nil
}

func (r *Registry) removePanelTabTransfer(transferID string) *panelTabTransfer {
	r.tabTransferMu.Lock()
	defer r.tabTransferMu.Unlock()
	return r.removePanelTabTransferLocked(transferID)
}

func (r *Registry) removePanelTabTransferLocked(transferID string) *panelTabTransfer {
	transfer := r.tabTransfers.finish(transferID)
	if transfer != nil && transfer.release != nil {
		transfer.release()
	}
	return transfer
}

// A tear-off's directory move committed with its new window's readiness.
func (r *Registry) finishOpenedPanelTabTransfer(transferID string) {
	r.tabTransferMu.Lock()
	transfer := r.removePanelTabTransferLocked(transferID)
	r.tabTransferMu.Unlock()
	if transfer != nil {
		r.emitPanelTabTransferEvent(transfer.request, panelwindow.TabTransferCommittedEventName, panelwindow.TabTransferCommittedEvent{Request: transfer.request})
	}
}

func (r *Registry) failPanelTabTransfer(transferID, reason string) {
	transfer := r.removePanelTabTransfer(transferID)
	if transfer == nil {
		return
	}
	r.abortOpeningPanelTabTarget(transfer)
	event := panelwindow.TabTransferFailedEvent{Request: transfer.request, Reason: reason}
	r.emitPanelTabTransferEvent(
		transfer.request,
		panelwindow.TabTransferFailedEventName,
		event,
	)
	// An app target re-reads the directory and drops its provisional copy.
	r.emitWorkspaceChanged(transfer.request.ClusterID)
}

func (r *Registry) beginPanelWindowOpenTransfer(
	snapshot PanelGroupSnapshot,
	reservation *panelwindow.WorkspaceReservation,
) (PanelWindowDescriptor, error) {
	r.tabTransferMu.Lock()
	defer r.tabTransferMu.Unlock()
	transfer := r.tabTransfers.get(snapshot.TransferID)
	if transfer == nil {
		if r.tabTransfers.wasUsed(snapshot.TransferID) {
			return PanelWindowDescriptor{}, fmt.Errorf(
				"panel tab transfer %q is no longer pending",
				snapshot.TransferID,
			)
		}
	}
	if transfer != nil {
		request := transfer.request
		if !r.tabTransfers.awaiting(snapshot.TransferID, transferAwaitingTarget) ||
			request.TargetKind != panelwindow.TabTransferTargetNewWindow ||
			request.SourceWindowName != snapshot.SourceWindowName ||
			request.ClusterID != snapshot.ClusterID ||
			request.TargetGroupID != snapshot.GroupID ||
			len(snapshot.Tabs) != 1 ||
			snapshot.ActivePanelID != request.Tab.PanelID ||
			!samePanelTab(snapshot.Tabs[0], request.Tab) {
			return PanelWindowDescriptor{}, fmt.Errorf(
				"new panel window does not match tab transfer %q",
				snapshot.TransferID,
			)
		}
	}
	descriptor, err := r.panels.BeginOpen(snapshot)
	if err != nil {
		return PanelWindowDescriptor{}, err
	}
	target := panelwindow.PanelLocation{Kind: panelwindow.PanelLocationWindow, WindowName: descriptor.WindowName, GroupID: snapshot.GroupID}
	if err := r.beginGroupPlacement(descriptor.WindowName, snapshot, target, reservation); err != nil {
		_ = r.panels.FailTransfer(descriptor.WindowName, snapshot.TransferID)
		return PanelWindowDescriptor{}, err
	}
	if transfer != nil {
		transfer.targetWindowName = descriptor.WindowName
		r.tabTransfers.setTimeout(snapshot.TransferID, 0, nil)
	}
	return descriptor, nil
}

func (r *Registry) abortOpeningPanelTabTarget(transfer *panelTabTransfer) {
	if transfer == nil || transfer.request.TargetKind != panelwindow.TabTransferTargetNewWindow ||
		transfer.targetWindowName == "" || r.panels == nil {
		return
	}
	descriptor, err := r.panels.Descriptor(transfer.targetWindowName)
	if err != nil || descriptor.State != PanelWindowStateOpening ||
		descriptor.TransferID != transfer.request.TransferID {
		return
	}
	if err := r.panels.FailTransfer(descriptor.WindowName, transfer.request.TransferID); err != nil {
		return
	}
	r.authorizeClose(descriptor.WindowName)
	if r.closeWindow == nil || !r.closeWindow(descriptor.WindowName) {
		r.consumeAuthorizedClose(descriptor.WindowName)
	}
	r.reportPanelLifecycleError(r.releaseNativePanelReference(descriptor.WindowName), "release failed native transfer target")
	r.emitPanelClosed(descriptor)
}

func (r *Registry) failPanelTabTransfersForWindow(windowName, reason string) {
	r.tabTransferMu.Lock()
	transferIDs := make([]string, 0)
	for transferID, transfer := range r.tabTransfers.all() {
		request := transfer.request
		if request.SourceWindowName == windowName ||
			request.TargetWindowName == windowName {
			transferIDs = append(transferIDs, transferID)
		}
	}
	r.tabTransferMu.Unlock()
	for _, transferID := range transferIDs {
		r.failPanelTabTransfer(transferID, reason)
	}
}

func (r *Registry) emitPanelTabTransferEvent(
	request panelwindow.TabTransferRequest,
	eventName string,
	payload any,
) {
	r.emitWindowEvent(request.SourceWindowName, eventName, payload)
	if request.TargetWindowName != "" && request.TargetWindowName != request.SourceWindowName {
		r.emitWindowEvent(request.TargetWindowName, eventName, payload)
	}
}

// A tear-off shares its ID with the window open it caused. The open validated
// the tab and bound the transfer to this window, and the native index never
// reuses an ID, so the ready window is always the tear-off's target.
func (r *Registry) completePanelTabTransferForOpenedWindow(transferID string) {
	r.tabTransferMu.Lock()
	transfer := r.tabTransfers.get(transferID)
	canCommit := transfer != nil &&
		r.tabTransfers.awaiting(transferID, transferAwaitingTarget) &&
		transfer.request.TargetKind == panelwindow.TabTransferTargetNewWindow
	r.tabTransferMu.Unlock()
	if canCommit {
		r.finishOpenedPanelTabTransfer(transferID)
	}
}
