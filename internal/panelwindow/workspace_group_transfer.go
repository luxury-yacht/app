package panelwindow

import (
	"fmt"
	"sort"
)

// PanelTransfer marks a panel whose whole group is moving to another renderer.
// Only the directory commits or cancels it. Renderers project it from reads: the
// source keeps rendering the panel and the target mounts a provisional copy.
type PanelTransfer struct {
	TransferID string        `json:"transferId"`
	Target     PanelLocation `json:"target"`
	// View marks a panel moving with its cluster view; the view handoff, not
	// the panel's target, settles the move.
	View bool `json:"view,omitempty"`
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
	d.recordTransferLocked(transfer.TransferID, keys)
	d.revision++
	return nil
}

// BeginViewTransfer records a pending move of a cluster view's docked panels:
// every panel the directory docks in source for the cluster, each keeping its
// group, order, and activation, appended after the target's existing tabs. It
// returns the moving groups so the target knows what it will reconstruct. A
// view without panels records an empty move that still commits.
func (d *WorkspaceDirectory) BeginViewTransfer(transferID, source, target, clusterID string, reservations ...*WorkspaceReservation) ([]WorkspaceGroup, error) {
	if transferID == "" || source == "" || target == "" || source == target || clusterID == "" {
		return nil, fmt.Errorf("view transfer requires transfer, cluster, and distinct window identity")
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	if err := d.validateReservationsLocked(reservations); err != nil {
		return nil, err
	}
	if _, exists := d.transfers[transferID]; exists {
		return nil, fmt.Errorf("panel group transfer %q already exists", transferID)
	}
	moving, err := d.viewPanelsLocked(source, clusterID)
	if err != nil {
		return nil, err
	}
	keys := make([]workspacePanelKey, 0, len(moving))
	for key, panel := range moving {
		location := panel.Location
		location.WindowName = target
		appended := location
		appended.Index = AppendToGroup
		location.Index += d.insertIndexLocked(clusterID, appended, moving)
		panel.Transfer = PanelTransfer{TransferID: transferID, Target: location, View: true}
		d.panels[key] = panel
		keys = append(keys, key)
	}
	d.recordTransferLocked(transferID, keys)
	d.revision++
	return viewGroups(clusterID, moving), nil
}

func (d *WorkspaceDirectory) viewPanelsLocked(source, clusterID string) (map[workspacePanelKey]WorkspacePanel, error) {
	moving := make(map[workspacePanelKey]WorkspacePanel)
	for key, panel := range d.panels {
		if key.clusterID != clusterID || panel.Location.Kind != PanelLocationDocked || panel.Location.WindowName != source {
			continue
		}
		if panel.moving() {
			return nil, fmt.Errorf("cluster view panel %q is already moving", key.panelID)
		}
		moving[key] = panel
	}
	return moving, nil
}

// viewGroups lists panels by group in index order.
func viewGroups(clusterID string, moving map[workspacePanelKey]WorkspacePanel) []WorkspaceGroup {
	byGroup := make(map[string][]WorkspacePanel)
	for _, panel := range moving {
		byGroup[panel.Location.GroupID] = append(byGroup[panel.Location.GroupID], panel)
	}
	groups := make([]WorkspaceGroup, 0, len(byGroup))
	for groupID, panels := range byGroup {
		sort.Slice(panels, func(i, j int) bool { return panels[i].Location.Index < panels[j].Location.Index })
		group := WorkspaceGroup{ClusterID: clusterID, GroupID: groupID, ActivePanelID: panels[0].Tab.PanelID}
		for _, panel := range panels {
			group.Tabs = append(group.Tabs, panel.Tab)
			if panel.Location.Active {
				group.ActivePanelID = panel.Tab.PanelID
			}
		}
		groups = append(groups, group)
	}
	sort.Slice(groups, func(i, j int) bool { return groups[i].GroupID < groups[j].GroupID })
	return groups
}

// WindowGroup lists the tabs a native panel window holds, in order: the panels
// placed in it, or, while it opens, the panels its opening transfer moves in.
func (d *WorkspaceDirectory) WindowGroup(clusterID, windowName, groupID, openingTransferID string) WorkspaceGroup {
	window := groupRef{clusterID, windowName, groupID, PanelLocationWindow}
	d.mu.Lock()
	defer d.mu.Unlock()
	held := make(map[workspacePanelKey]WorkspacePanel)
	for key, panel := range d.panels {
		if openingTransferID != "" && panel.Transfer.TransferID == openingTransferID {
			panel.Location = panel.Transfer.Target
		}
		if refOf(key.clusterID, panel.Location) == window {
			held[key] = panel
		}
	}
	if groups := viewGroups(clusterID, held); len(groups) == 1 {
		return groups[0]
	}
	return WorkspaceGroup{ClusterID: clusterID, GroupID: groupID}
}

// TransferTarget reports where a pending move takes its panels.
func (d *WorkspaceDirectory) TransferTarget(transferID string) (PanelLocation, bool) {
	d.mu.Lock()
	defer d.mu.Unlock()
	keys := d.transfers[transferID]
	if len(keys) == 0 {
		return PanelLocation{}, false
	}
	return d.panels[keys[0]].Transfer.Target, true
}

// MovesInto lists the pending moves taking panels into windowName.
func (d *WorkspaceDirectory) MovesInto(windowName string) []string {
	d.mu.Lock()
	defer d.mu.Unlock()
	var ids []string
	for id, keys := range d.transfers {
		if len(keys) > 0 && d.panels[keys[0]].Transfer.Target.WindowName == windowName {
			ids = append(ids, id)
		}
	}
	sort.Strings(ids)
	return ids
}

func (d *WorkspaceDirectory) recordTransferLocked(transferID string, keys []workspacePanelKey) {
	if d.transfers == nil {
		d.transfers = make(map[string][]workspacePanelKey)
	}
	d.transfers[transferID] = keys
}

// groupRef identifies one cluster's group in one renderer.
type groupRef struct {
	clusterID, windowName, groupID string
	kind                           PanelLocationKind
}

func refOf(clusterID string, location PanelLocation) groupRef {
	return groupRef{clusterID, location.WindowName, location.GroupID, location.Kind}
}

// The moving group lands at the requested index within the target group, or
// after its existing tabs when the index is AppendToGroup or out of range.
func (d *WorkspaceDirectory) insertIndexLocked(clusterID string, target PanelLocation, moving map[workspacePanelKey]WorkspacePanel) int {
	size := 0
	group := refOf(clusterID, target)
	for key, panel := range d.panels {
		if _, isMoving := moving[key]; !isMoving && refOf(key.clusterID, panel.Location) == group {
			size++
		}
	}
	if target.Index < 0 || target.Index > size {
		return size
	}
	return target.Index
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
	}
	d.revision++
	return nil
}

type arrival struct {
	base, count int
	activates   bool
}

// In each group receiving panels, existing tabs at or after the arrivals' index
// move behind them, and an arriving active tab takes activation. Indexes order
// a group; gaps are allowed because the target renderer republishes its
// arrangement.
func (d *WorkspaceDirectory) makeRoomLocked(next map[workspacePanelKey]WorkspacePanel) {
	arrivals := make(map[groupRef]arrival)
	for key, panel := range next {
		ref := refOf(key.clusterID, panel.Location)
		group, seen := arrivals[ref]
		if !seen || panel.Location.Index < group.base {
			group.base = panel.Location.Index
		}
		group.count++
		group.activates = group.activates || panel.Location.Active
		arrivals[ref] = group
	}
	for key, panel := range d.panels {
		group, arriving := arrivals[refOf(key.clusterID, panel.Location)]
		if _, isMoving := next[key]; isMoving || !arriving {
			continue
		}
		if panel.Location.Index >= group.base {
			panel.Location.Index += group.count
		}
		panel.Location.Active = panel.Location.Active && !group.activates
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
