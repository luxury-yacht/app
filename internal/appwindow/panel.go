package appwindow

import (
	"fmt"
	"sort"
	"sync"
	"time"

	"github.com/luxury-yacht/app/internal/panelwindow"
)

// PanelWindowSpec identifies a native panel window within its cluster.
type panelWindowSpec struct {
	ClusterID string
	GroupID   string
}

const (
	PanelWindowStateMissing = panelwindow.WindowStateMissing
	PanelWindowStateOpening = panelwindow.WindowStateOpening
	PanelWindowStateLive    = panelwindow.WindowStateLive
	PanelWindowStateDocking = panelwindow.WindowStateDocking
)

type PanelWindowState = panelwindow.WindowState
type PanelWindowDescriptor = panelwindow.WindowDescriptor

type panelGroupTransfer struct {
	windowName   string
	state        PanelWindowState
	dockTarget   string
	dockPosition string
}

type panelIndex struct {
	mu            sync.Mutex
	next          uint64
	panels        map[string]panelWindowSpec
	clusterGroups map[string]map[string]string
	snapshots     map[string]PanelGroupSnapshot
	transfers     transferLifecycle[panelGroupTransfer]
}

func newPanelIndex() *panelIndex {
	return &panelIndex{
		panels:        make(map[string]panelWindowSpec),
		clusterGroups: make(map[string]map[string]string),
		snapshots:     make(map[string]PanelGroupSnapshot),
	}
}

func (p *panelIndex) BeginOpen(snapshot PanelGroupSnapshot) (PanelWindowDescriptor, error) {
	if err := ValidatePanelGroupSnapshot(snapshot); err != nil {
		return PanelWindowDescriptor{}, err
	}
	spec := panelWindowSpec{
		ClusterID: snapshot.ClusterID,
		GroupID:   snapshot.GroupID,
	}

	p.mu.Lock()
	defer p.mu.Unlock()
	if p.transfers.wasUsed(snapshot.TransferID) {
		return PanelWindowDescriptor{}, fmt.Errorf("panel transfer %q already exists", snapshot.TransferID)
	}
	name, err := p.addLocked(spec)
	if err != nil {
		return PanelWindowDescriptor{}, err
	}
	if err := p.transfers.begin(snapshot.TransferID, &panelGroupTransfer{windowName: name, state: PanelWindowStateOpening}, transferAwaitingTarget); err != nil {
		p.removeLocked(name)
		return PanelWindowDescriptor{}, err
	}
	p.snapshots[name] = clonePanelGroupSnapshot(snapshot)
	return p.descriptorLocked(name), nil
}

func (p *panelIndex) AcknowledgeOpen(
	windowName, transferID string,
) (PanelWindowDescriptor, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	_, err := p.pendingLocked(windowName, transferID, PanelWindowStateOpening)
	if err != nil {
		return PanelWindowDescriptor{}, err
	}
	p.transfers.finish(transferID)
	return p.descriptorLocked(windowName), nil
}

func (p *panelIndex) BeginDock(windowName string, snapshot PanelGroupSnapshot, targetWindow, targetPosition string) error {
	if err := ValidatePanelGroupSnapshot(snapshot); err != nil {
		return err
	}

	p.mu.Lock()
	defer p.mu.Unlock()
	spec, exists := p.panels[windowName]
	if !exists {
		return fmt.Errorf("panel window %q is not live", windowName)
	}
	state := p.stateLocked(windowName)
	if state != PanelWindowStateLive {
		return fmt.Errorf("panel window %q cannot dock from state %q", windowName, state)
	}
	if snapshot.ClusterID != spec.ClusterID ||
		snapshot.GroupID != spec.GroupID {
		return fmt.Errorf("panel window %q cannot change cluster or group", windowName)
	}
	if p.transfers.wasUsed(snapshot.TransferID) {
		return fmt.Errorf("panel transfer %q already exists", snapshot.TransferID)
	}
	if err := p.transfers.begin(snapshot.TransferID, &panelGroupTransfer{
		windowName: windowName, state: PanelWindowStateDocking, dockTarget: targetWindow, dockPosition: targetPosition,
	}, transferAwaitingTarget); err != nil {
		return err
	}
	p.snapshots[windowName] = clonePanelGroupSnapshot(snapshot)

	return nil
}

func (p *panelIndex) ValidateSnapshot(windowName string, snapshot PanelGroupSnapshot) error {
	if err := ValidatePanelGroupSnapshot(snapshot); err != nil {
		return err
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.validateSnapshotLocked(windowName, snapshot)
}

func (p *panelIndex) validateSnapshotLocked(windowName string, snapshot PanelGroupSnapshot) error {
	spec, exists := p.panels[windowName]
	if !exists {
		return fmt.Errorf("panel window %q is not live", windowName)
	}
	state := p.stateLocked(windowName)
	if state != PanelWindowStateLive {
		return fmt.Errorf("panel window %q cannot update snapshot from state %q", windowName, state)
	}
	if snapshot.ClusterID != spec.ClusterID || snapshot.GroupID != spec.GroupID {
		return fmt.Errorf("panel window %q cannot change cluster or group", windowName)
	}
	return nil
}

func (p *panelIndex) UpdateSnapshot(windowName string, snapshot PanelGroupSnapshot) error {
	if err := ValidatePanelGroupSnapshot(snapshot); err != nil {
		return err
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if err := p.validateSnapshotLocked(windowName, snapshot); err != nil {
		return err
	}
	p.snapshots[windowName] = clonePanelGroupSnapshot(snapshot)
	return nil
}

func (p *panelIndex) AcknowledgeDock(windowName, transferID string) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	if _, err := p.pendingLocked(windowName, transferID, PanelWindowStateDocking); err != nil {
		return err
	}
	p.removeLocked(windowName)
	return nil
}

func (p *panelIndex) FailTransfer(windowName, transferID string) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	snapshot, exists := p.snapshots[windowName]
	if !exists {
		return fmt.Errorf("panel window %q is not live", windowName)
	}
	if snapshot.TransferID != transferID {
		return fmt.Errorf("stale panel transfer %q for window %q", transferID, windowName)
	}
	transfer := p.windowTransferLocked(windowName)
	if transfer == nil {
		return fmt.Errorf("panel window %q has no pending transfer in state %q", windowName, PanelWindowStateLive)
	}
	if transfer.state == PanelWindowStateOpening {
		p.removeLocked(windowName)
	} else {
		p.transfers.finish(transferID)
	}
	return nil
}

func (p *panelIndex) State(windowName string) PanelWindowState {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.stateLocked(windowName)
}

func (p *panelIndex) stateLocked(windowName string) PanelWindowState {
	_, exists := p.snapshots[windowName]
	if !exists {
		return PanelWindowStateMissing
	}
	if transfer := p.windowTransferLocked(windowName); transfer != nil {
		return transfer.state
	}
	return PanelWindowStateLive
}

// Published snapshots carry correlation IDs but cannot adopt another window's
// pending operation. The registry binds that operation to its native window.
func (p *panelIndex) windowTransferLocked(windowName string) *panelGroupTransfer {
	transfer := p.transfers.get(p.snapshots[windowName].TransferID)
	if transfer != nil && transfer.windowName == windowName {
		return transfer
	}
	return nil
}

func (p *panelIndex) setTransferTimeout(windowName, transferID string, duration time.Duration, expire func()) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.windowTransferLocked(windowName) != nil && p.snapshots[windowName].TransferID == transferID {
		p.transfers.setTimeout(transferID, duration, expire)
	}
}

func (p *panelIndex) Descriptor(windowName string) (PanelWindowDescriptor, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if _, exists := p.panels[windowName]; !exists {
		return PanelWindowDescriptor{}, fmt.Errorf("panel window %q is not live", windowName)
	}
	return p.descriptorLocked(windowName), nil
}

func (p *panelIndex) Remove(windowName string) bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	if _, exists := p.panels[windowName]; !exists {
		return false
	}
	p.removeLocked(windowName)
	return true
}

func (p *panelIndex) addLocked(spec panelWindowSpec) (string, error) {
	groups := p.clusterGroups[spec.ClusterID]
	if groups == nil {
		groups = make(map[string]string)
		p.clusterGroups[spec.ClusterID] = groups
	}
	if existing := groups[spec.GroupID]; existing != "" {
		return "", fmt.Errorf(
			"cluster %q already owns panel group %q in window %q",
			spec.ClusterID,
			spec.GroupID,
			existing,
		)
	}

	p.next++
	name := fmt.Sprintf("panel-%d", p.next)
	p.panels[name] = spec
	groups[spec.GroupID] = name
	return name, nil
}

func (p *panelIndex) pendingLocked(windowName, transferID string, want PanelWindowState) (*panelGroupTransfer, error) {
	snapshot, exists := p.snapshots[windowName]
	if !exists {
		return nil, fmt.Errorf("panel window %q is not live", windowName)
	}
	state := p.stateLocked(windowName)
	if state != want {
		return nil, fmt.Errorf("panel window %q is in state %q, not %q", windowName, state, want)
	}
	if snapshot.TransferID != transferID {
		return nil, fmt.Errorf("stale panel transfer %q for window %q", transferID, windowName)
	}
	return p.transfers.get(transferID), nil
}

func (p *panelIndex) descriptorLocked(windowName string) PanelWindowDescriptor {
	spec := p.panels[windowName]
	snapshot := p.snapshots[windowName]
	return PanelWindowDescriptor{
		WindowName: windowName,
		ClusterID:  spec.ClusterID,
		GroupID:    spec.GroupID,
		State:      p.stateLocked(windowName),
		Snapshot:   clonePanelGroupSnapshot(snapshot),
	}
}

func (p *panelIndex) removeLocked(windowName string) {
	spec, exists := p.panels[windowName]
	if !exists {
		return
	}
	delete(p.panels, windowName)
	if p.windowTransferLocked(windowName) != nil {
		p.transfers.finish(p.snapshots[windowName].TransferID)
	}
	delete(p.snapshots, windowName)
	groups := p.clusterGroups[spec.ClusterID]
	delete(groups, spec.GroupID)
	if len(groups) == 0 {
		delete(p.clusterGroups, spec.ClusterID)
	}
}

func clonePanelGroupSnapshot(snapshot PanelGroupSnapshot) PanelGroupSnapshot {
	result := snapshot
	result.Tabs = append([]PanelTabSnapshot(nil), snapshot.Tabs...)
	if snapshot.InitialBounds != nil {
		bounds := *snapshot.InitialBounds
		result.InitialBounds = &bounds
	}
	if snapshot.InitialPositionAnchor != nil {
		anchor := *snapshot.InitialPositionAnchor
		result.InitialPositionAnchor = &anchor
	}
	return result
}

func (p *panelIndex) Names(clusterID string) []string {
	p.mu.Lock()
	defer p.mu.Unlock()
	names := make([]string, 0, len(p.panels))
	for name, spec := range p.panels {
		if clusterID == "" || spec.ClusterID == clusterID {
			names = append(names, name)
		}
	}
	sort.Strings(names)
	return names
}

func (p *panelIndex) DockTarget(windowName, transferID, caller string) (string, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	record, err := p.pendingLocked(windowName, transferID, PanelWindowStateDocking)
	if err != nil {
		return "", err
	}
	if record.dockTarget != caller {
		return "", fmt.Errorf("panel dock target does not match caller")
	}
	return record.dockPosition, nil
}

func (p *panelIndex) IsTransferParticipant(windowName, caller string) bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	snapshot, exists := p.snapshots[windowName]
	if !exists {
		return false
	}
	transfer := p.windowTransferLocked(windowName)
	if caller == windowName {
		return true
	}
	return transfer != nil && ((transfer.state == PanelWindowStateOpening && caller == snapshot.SourceWindowName) || (transfer.state == PanelWindowStateDocking && caller == transfer.dockTarget))
}
