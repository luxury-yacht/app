package panelwindow

import "fmt"

// PanelTransfer marks a panel whose whole group is moving to another renderer.
// Only the directory commits or cancels it. Renderers project it from reads: the
// source keeps rendering the panel and the target mounts a provisional copy.
type PanelTransfer struct {
	TransferID string        `json:"transferId"`
	Target     PanelLocation `json:"target"`
}

// GroupTransfer is a renderer's intent to move a same-cluster group. Its tabs
// name panels the directory already places in SourceWindow; they contribute
// view state only, never placement.
type GroupTransfer struct {
	TransferID   string
	SourceWindow string
	Target       PanelLocation
	Group        WorkspaceGroup
}

func (panel WorkspacePanel) moving() bool {
	return panel.Transfer.TransferID != ""
}

// BeginGroupTransfer records a pending move without changing placement.
func (d *WorkspaceDirectory) BeginGroupTransfer(transfer GroupTransfer, reservations ...*WorkspaceReservation) error {
	if transfer.TransferID == "" || transfer.SourceWindow == "" {
		return fmt.Errorf("panel group transfer requires transfer and source identity")
	}
	group := transfer.Group
	group.GroupID = transfer.Target.GroupID
	next, err := panelsFromGroups(transfer.Target.WindowName, transfer.Target.Kind, []WorkspaceGroup{group})
	if err != nil {
		return err
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	if err := d.validateReservationsLocked(reservations); err != nil {
		return err
	}
	if _, exists := d.transfers[transfer.TransferID]; exists {
		return fmt.Errorf("panel group transfer %q already exists", transfer.TransferID)
	}
	if err := d.validateGroupTransferSourceLocked(transfer.SourceWindow, next); err != nil {
		return err
	}
	keys := make([]workspacePanelKey, 0, len(next))
	for key, target := range next {
		panel := d.panels[key]
		panel.Tab = target.Tab
		panel.Transfer = PanelTransfer{TransferID: transfer.TransferID, Target: target.Location}
		d.panels[key] = panel
		keys = append(keys, key)
	}
	if d.transfers == nil {
		d.transfers = make(map[string][]workspacePanelKey)
	}
	d.transfers[transfer.TransferID] = keys
	d.revision++
	return nil
}

func (d *WorkspaceDirectory) validateGroupTransferSourceLocked(source string, next map[workspacePanelKey]WorkspacePanel) error {
	for key, target := range next {
		current, exists := d.panels[key]
		if !exists || current.Tab.identity() != target.Tab.identity() || current.Location.WindowName != source || current.moving() {
			return fmt.Errorf("panel group transfer source is stale")
		}
	}
	return nil
}

// CommitGroupTransfer applies the recorded target placement as one mutation.
func (d *WorkspaceDirectory) CommitGroupTransfer(transferID string) error {
	d.mu.Lock()
	defer d.mu.Unlock()
	keys, pending := d.transfers[transferID]
	if !pending {
		return fmt.Errorf("panel group transfer %q is no longer pending", transferID)
	}
	delete(d.transfers, transferID)
	next := make(map[workspacePanelKey]WorkspacePanel, len(keys))
	var target PanelLocation
	for _, key := range keys {
		panel := d.panels[key]
		target = panel.Transfer.Target
		panel.Location, panel.Transfer = target, PanelTransfer{}
		next[key] = panel
	}
	if target.Kind == PanelLocationDocked {
		d.appendPlacementsLocked(target.WindowName, next)
	}
	for key, panel := range next {
		d.panels[key] = panel
		delete(d.unpublished, key)
	}
	d.revision++
	return nil
}

// CancelGroupTransfer releases a pending move; placement never changed.
func (d *WorkspaceDirectory) CancelGroupTransfer(transferID string) bool {
	d.mu.Lock()
	defer d.mu.Unlock()
	keys, pending := d.transfers[transferID]
	if !pending {
		return false
	}
	delete(d.transfers, transferID)
	for _, key := range keys {
		panel := d.panels[key]
		panel.Transfer = PanelTransfer{}
		d.panels[key] = panel
	}
	d.revision++
	return true
}

// A deleted panel leaves its transfer so commit cannot recreate it.
func (d *WorkspaceDirectory) leaveTransferLocked(key workspacePanelKey) {
	transferID := d.panels[key].Transfer.TransferID
	if transferID == "" {
		return
	}
	remaining := make([]workspacePanelKey, 0, len(d.transfers[transferID]))
	for _, member := range d.transfers[transferID] {
		if member != key {
			remaining = append(remaining, member)
		}
	}
	if len(remaining) == 0 {
		delete(d.transfers, transferID)
		return
	}
	d.transfers[transferID] = remaining
}
