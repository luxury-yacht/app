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

// AppendToGroup places a moving group after the target group's existing tabs.
const AppendToGroup = -1

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
	base := d.insertIndexLocked(transfer.Group.ClusterID, transfer.Target, next)
	keys := make([]workspacePanelKey, 0, len(next))
	for key, target := range next {
		panel := d.panels[key]
		panel.Tab = target.Tab
		target.Location.Index += base
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

// The moving group lands at the requested index within the target group, or
// after its existing tabs when the index is AppendToGroup or out of range.
func (d *WorkspaceDirectory) insertIndexLocked(clusterID string, target PanelLocation, moving map[workspacePanelKey]WorkspacePanel) int {
	size := 0
	for key, panel := range d.panels {
		if _, isMoving := moving[key]; !isMoving && inGroup(key, panel, clusterID, target) {
			size++
		}
	}
	if target.Index < 0 || target.Index > size {
		return size
	}
	return target.Index
}

func inGroup(key workspacePanelKey, panel WorkspacePanel, clusterID string, group PanelLocation) bool {
	return key.clusterID == clusterID && panel.Location.Kind == group.Kind &&
		panel.Location.WindowName == group.WindowName && panel.Location.GroupID == group.GroupID
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
	for _, key := range keys {
		panel := d.panels[key]
		panel.Location, panel.Transfer = panel.Transfer.Target, PanelTransfer{}
		next[key] = panel
	}
	d.makeRoomLocked(next)
	for key, panel := range next {
		d.panels[key] = panel
		delete(d.unpublished, key)
	}
	d.revision++
	return nil
}

// Existing tabs at or after the arriving group's index move behind it, and an
// arriving active tab takes activation. Indexes order a group; gaps are allowed
// because the target renderer republishes its arrangement.
func (d *WorkspaceDirectory) makeRoomLocked(next map[workspacePanelKey]WorkspacePanel) {
	var clusterID string
	var target PanelLocation
	base, activates := -1, false
	for key, panel := range next {
		clusterID, target = key.clusterID, panel.Location
		if base < 0 || panel.Location.Index < base {
			base = panel.Location.Index
		}
		activates = activates || panel.Location.Active
	}
	for key, panel := range d.panels {
		if _, isMoving := next[key]; isMoving || !inGroup(key, panel, clusterID, target) {
			continue
		}
		if panel.Location.Index >= base {
			panel.Location.Index += len(next)
		}
		panel.Location.Active = panel.Location.Active && !activates
		d.panels[key] = panel
	}
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
