package appwindow

import "github.com/luxury-yacht/app/internal/panelwindow"

func (r *Registry) publishPanelGroups(windowName string, kind panelwindow.PanelLocationKind, groups []panelwindow.WorkspaceGroup, reservations ...*panelwindow.WorkspaceReservation) error {
	r.tabTransferMu.Lock()
	approvals := make([]panelwindow.PlacementTransfer, 0)
	for id, transfer := range r.tabTransfers.all() {
		request := transfer.request
		if !r.tabTransfers.awaiting(id, transferAwaitingTarget) || request.TargetKind == panelwindow.TabTransferTargetNewWindow || request.TargetWindowName != windowName {
			continue
		}
		approvals = append(approvals, panelwindow.PlacementTransfer{TransferID: id, Tab: request.Tab, SourceWindowName: request.SourceWindowName, SourceGroupID: request.SourceGroupID, TargetGroupID: request.TargetGroupID})
	}
	committed, err := r.workspace.PublishWindowWithTransfers(windowName, kind, groups, approvals, reservations...)
	if err != nil {
		r.tabTransferMu.Unlock()
		return err
	}
	requests := make([]panelwindow.TabTransferRequest, 0, len(committed))
	for _, id := range committed {
		transfer := r.removePanelTabTransferLocked(id)
		requests = append(requests, transfer.request)
	}
	r.tabTransferMu.Unlock()
	for _, request := range requests {
		r.emitPanelTabTransferEvent(request, panelwindow.TabTransferCommittedEventName, panelwindow.TabTransferCommittedEvent{Request: request})
	}
	return nil
}
