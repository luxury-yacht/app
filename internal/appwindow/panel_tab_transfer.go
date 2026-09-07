package appwindow

import (
	"fmt"
	"time"

	"github.com/luxury-yacht/app/internal/panelwindow"
)

type panelTabTransferStage string

const (
	panelTabTransferRequested panelTabTransferStage = "requested"
	panelTabTransferInserting panelTabTransferStage = "inserting"
	panelTabTransferOpening   panelTabTransferStage = "opening"
)

type panelTabTransfer struct {
	request          panelwindow.TabTransferRequest
	stage            panelTabTransferStage
	targetWindowName string
	timeout          *time.Timer
}

func samePanelTab(left, right panelwindow.TabSnapshot) bool {
	return left == right
}

func snapshotContainsPanelTab(snapshot PanelGroupSnapshot, tab panelwindow.TabSnapshot) bool {
	for _, candidate := range snapshot.Tabs {
		if samePanelTab(candidate, tab) {
			return true
		}
	}
	return false
}

func (r *Registry) validatePanelTabTransferSource(request panelwindow.TabTransferRequest) error {
	if !r.windowHasCluster(request.SourceWindowName, request.ClusterID) {
		return fmt.Errorf("source window does not display the transfer cluster")
	}
	for _, panel := range r.workspace.Snapshot(request.ClusterID).Panels {
		if panel.Tab == request.Tab && panel.Location.WindowName == request.SourceWindowName && panel.Location.GroupID == request.SourceGroupID {
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

func (r *Registry) ensurePanelTabTransferState() {
	if r.pendingTabTransfers == nil {
		r.pendingTabTransfers = make(map[string]*panelTabTransfer)
	}
	if r.usedTabTransferIDs == nil {
		r.usedTabTransferIDs = make(map[string]struct{})
	}
}

func (r *Registry) resetPanelTabTransferTimeoutLocked(transfer *panelTabTransfer) {
	if transfer.timeout != nil {
		transfer.timeout.Stop()
		transfer.timeout = nil
	}
	if r.tabTransferTimeout > 0 {
		transferID := transfer.request.TransferID
		transfer.timeout = time.AfterFunc(r.tabTransferTimeout, func() {
			r.failPanelTabTransfer(transferID, "panel tab transfer timed out")
		})
	}
}

func (r *Registry) RequestPanelTabTransfer(
	callerWindowName string,
	request panelwindow.TabTransferRequest,
) error {
	if err := panelwindow.ValidateTabTransferRequest(request); err != nil {
		return err
	}
	expectedCaller := request.TargetWindowName
	if request.TargetKind == panelwindow.TabTransferTargetNewWindow {
		expectedCaller = request.SourceWindowName
	}
	if callerWindowName != expectedCaller {
		return fmt.Errorf("window %q cannot request panel tab transfer %q", callerWindowName, request.TransferID)
	}
	if err := r.validatePanelTabTransferSource(request); err != nil {
		return err
	}
	if err := r.validatePanelTabTransferTarget(request); err != nil {
		return err
	}

	r.tabTransferMu.Lock()
	r.ensurePanelTabTransferState()
	if _, exists := r.usedTabTransferIDs[request.TransferID]; exists {
		r.tabTransferMu.Unlock()
		return fmt.Errorf("panel tab transfer %q already exists", request.TransferID)
	}
	for _, pending := range r.pendingTabTransfers {
		if pending.request.ClusterID == request.ClusterID &&
			pending.request.SourceWindowName == request.SourceWindowName &&
			pending.request.Tab.PanelID == request.Tab.PanelID {
			r.tabTransferMu.Unlock()
			return fmt.Errorf(
				"panel tab %q already has a pending transfer",
				request.Tab.PanelID,
			)
		}
	}
	transfer := &panelTabTransfer{request: request, stage: panelTabTransferRequested}
	r.resetPanelTabTransferTimeoutLocked(transfer)
	r.usedTabTransferIDs[request.TransferID] = struct{}{}
	r.pendingTabTransfers[request.TransferID] = transfer
	r.tabTransferMu.Unlock()

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

func (r *Registry) AcceptPanelTabTransfer(callerWindowName, transferID string) error {
	r.tabTransferMu.Lock()
	transfer, exists := r.pendingTabTransfers[transferID]
	if !exists || transfer.stage != panelTabTransferRequested {
		r.tabTransferMu.Unlock()
		return fmt.Errorf("stale panel tab transfer %q", transferID)
	}
	request := transfer.request
	if request.SourceWindowName != callerWindowName {
		r.tabTransferMu.Unlock()
		return fmt.Errorf("panel tab transfer %q is not owned by %q", transferID, callerWindowName)
	}
	switch request.TargetKind {
	case panelwindow.TabTransferTargetWorkspace, panelwindow.TabTransferTargetPanelWindow:
		transfer.stage = panelTabTransferInserting
		r.resetPanelTabTransferTimeoutLocked(transfer)
	case panelwindow.TabTransferTargetNewWindow:
		transfer.stage = panelTabTransferOpening
		r.resetPanelTabTransferTimeoutLocked(transfer)
	}
	r.tabTransferMu.Unlock()

	if request.TargetKind == panelwindow.TabTransferTargetNewWindow {
		return nil
	}
	if r.emitWindowEvent(
		request.TargetWindowName,
		panelwindow.TabTransferInsertRequestedEventName,
		panelwindow.TabTransferInsertRequestedEvent{Request: request},
	) {
		return nil
	}
	r.failPanelTabTransfer(transferID, "target panel window is not available")
	return fmt.Errorf("target panel window %q is not available", request.TargetWindowName)
}

func (r *Registry) FailPanelTabTransfer(callerWindowName, transferID string) error {
	r.tabTransferMu.Lock()
	transfer, exists := r.pendingTabTransfers[transferID]
	if !exists {
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
	transfer := r.pendingTabTransfers[transferID]
	if transfer == nil {
		return nil
	}
	delete(r.pendingTabTransfers, transferID)
	if transfer.timeout != nil {
		transfer.timeout.Stop()
	}
	return transfer
}

func (r *Registry) commitPanelTabTransfer(transferID string) {
	r.tabTransferMu.Lock()
	transfer := r.pendingTabTransfers[transferID]
	if transfer == nil {
		r.tabTransferMu.Unlock()
		return
	}
	request := transfer.request
	targetName := request.TargetWindowName
	if transfer.stage == panelTabTransferOpening {
		targetName = transfer.targetWindowName
	}
	if err := r.moveTransferredPanel(request, targetName); err != nil {
		r.tabTransferMu.Unlock()
		r.failPanelTabTransfer(transferID, err.Error())
		return
	}
	delete(r.pendingTabTransfers, transferID)
	if transfer.timeout != nil {
		transfer.timeout.Stop()
	}
	r.tabTransferMu.Unlock()
	r.emitPanelTabTransferEvent(request, panelwindow.TabTransferCommittedEventName, panelwindow.TabTransferCommittedEvent{Request: request}, true)
}

func (r *Registry) moveTransferredPanel(request panelwindow.TabTransferRequest, targetWindowName string) error {
	kind := panelwindow.PanelLocationWindow
	if request.TargetKind == panelwindow.TabTransferTargetWorkspace {
		kind = panelwindow.PanelLocationDocked
	}
	target := panelwindow.PanelLocation{Kind: kind, WindowName: targetWindowName, GroupID: request.TargetGroupID, Index: request.TargetIndex, Active: true}
	for _, panel := range r.workspace.Snapshot(request.ClusterID).Panels {
		if panel.Tab.PanelID != request.Tab.PanelID {
			continue
		}
		if panel.Tab == request.Tab && panel.Location.WindowName == targetWindowName && panel.Location.GroupID == request.TargetGroupID {
			return nil
		}
		if panel.Location.WindowName != request.SourceWindowName || panel.Location.GroupID != request.SourceGroupID {
			break
		}
		return r.workspace.Move(request.Tab, panel.Location, target)
	}
	return fmt.Errorf("panel transfer source is stale")
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
		true,
	)
}

func (r *Registry) beginPanelWindowOpenTransfer(
	snapshot PanelGroupSnapshot,
) (PanelWindowDescriptor, error) {
	r.tabTransferMu.Lock()
	defer r.tabTransferMu.Unlock()
	r.ensurePanelTabTransferState()
	transfer := r.pendingTabTransfers[snapshot.TransferID]
	if transfer == nil {
		if _, used := r.usedTabTransferIDs[snapshot.TransferID]; used {
			return PanelWindowDescriptor{}, fmt.Errorf(
				"panel tab transfer %q is no longer pending",
				snapshot.TransferID,
			)
		}
	}
	if transfer != nil {
		request := transfer.request
		if transfer.stage != panelTabTransferOpening ||
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
	if transfer != nil {
		transfer.targetWindowName = descriptor.WindowName
		if transfer.timeout != nil {
			transfer.timeout.Stop()
			transfer.timeout = nil
		}
	}
	return descriptor, nil
}

func (r *Registry) abortOpeningPanelTabTarget(transfer *panelTabTransfer) {
	if transfer == nil || transfer.stage != panelTabTransferOpening ||
		transfer.targetWindowName == "" || r.panels == nil {
		return
	}
	descriptor, err := r.panels.Descriptor(transfer.targetWindowName)
	if err != nil || descriptor.State != PanelWindowStateOpening ||
		descriptor.Snapshot.TransferID != transfer.request.TransferID {
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
	for transferID, transfer := range r.pendingTabTransfers {
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
	includeTarget bool,
) {
	targets := []string{request.SourceWindowName}
	if includeTarget && request.TargetWindowName != "" {
		targets = append(targets, request.TargetWindowName)
	}
	emitted := make(map[string]struct{}, len(targets))
	for _, target := range targets {
		if _, duplicate := emitted[target]; duplicate {
			continue
		}
		emitted[target] = struct{}{}
		r.emitWindowEvent(target, eventName, payload)
	}
}

func (r *Registry) completePanelTabTransferForOpenedWindow(descriptor PanelWindowDescriptor) {
	r.tabTransferMu.Lock()
	transfer := r.pendingTabTransfers[descriptor.Snapshot.TransferID]
	canCommit := transfer != nil &&
		transfer.stage == panelTabTransferOpening &&
		transfer.request.SourceWindowName == descriptor.Snapshot.SourceWindowName &&
		transfer.request.ClusterID == descriptor.ClusterID &&
		transfer.request.TargetGroupID == descriptor.GroupID &&
		snapshotContainsPanelTab(descriptor.Snapshot, transfer.request.Tab)
	r.tabTransferMu.Unlock()
	if canCommit {
		r.commitPanelTabTransfer(descriptor.Snapshot.TransferID)
	}
}
