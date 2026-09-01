package appwindow

import (
	"fmt"
	"sort"
	"sync"

	"github.com/luxury-yacht/app/internal/panelwindow"
)

// PanelWindowSpec identifies a native panel window within its immutable owner
// workspace and cluster.
type panelWindowSpec struct {
	OwnerWindowName string
	ClusterID       string
	GroupID         string
}

const (
	PanelWindowStateMissing = panelwindow.WindowStateMissing
	PanelWindowStateOpening = panelwindow.WindowStateOpening
	PanelWindowStateLive    = panelwindow.WindowStateLive
	PanelWindowStateDocking = panelwindow.WindowStateDocking
)

type PanelWindowState = panelwindow.WindowState
type PanelWindowDescriptor = panelwindow.WindowDescriptor

type panelTransferRecord struct {
	state      PanelWindowState
	transferID string
	snapshot   PanelGroupSnapshot
}

type panelIndex struct {
	mu          sync.Mutex
	next        uint64
	panels      map[string]panelWindowSpec
	ownerGroups map[string]map[string]string
	transfers   map[string]panelTransferRecord
	usedIDs     map[string]struct{}
}

func newPanelIndex() *panelIndex {
	return &panelIndex{
		panels:      make(map[string]panelWindowSpec),
		ownerGroups: make(map[string]map[string]string),
		transfers:   make(map[string]panelTransferRecord),
		usedIDs:     make(map[string]struct{}),
	}
}

func (p *panelIndex) BeginOpen(snapshot PanelGroupSnapshot) (PanelWindowDescriptor, error) {
	if err := ValidatePanelGroupSnapshot(snapshot); err != nil {
		return PanelWindowDescriptor{}, err
	}
	spec := panelWindowSpec{
		OwnerWindowName: snapshot.OwnerWindowName,
		ClusterID:       snapshot.ClusterID,
		GroupID:         snapshot.GroupID,
	}

	p.mu.Lock()
	defer p.mu.Unlock()
	if _, used := p.usedIDs[snapshot.TransferID]; used {
		return PanelWindowDescriptor{}, fmt.Errorf("panel transfer %q already exists", snapshot.TransferID)
	}
	name, err := p.addLocked(spec)
	if err != nil {
		return PanelWindowDescriptor{}, err
	}
	p.usedIDs[snapshot.TransferID] = struct{}{}
	p.transfers[name] = panelTransferRecord{
		state:      PanelWindowStateOpening,
		transferID: snapshot.TransferID,
		snapshot:   clonePanelGroupSnapshot(snapshot),
	}
	return p.descriptorLocked(name), nil
}

func (p *panelIndex) AcknowledgeOpen(
	windowName string,
	transferID string,
) (PanelWindowDescriptor, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	record, err := p.pendingLocked(windowName, transferID, PanelWindowStateOpening)
	if err != nil {
		return PanelWindowDescriptor{}, err
	}
	record.state = PanelWindowStateLive
	p.transfers[windowName] = record
	return p.descriptorLocked(windowName), nil
}

func (p *panelIndex) BeginDock(windowName string, snapshot PanelGroupSnapshot) error {
	if err := ValidatePanelGroupSnapshot(snapshot); err != nil {
		return err
	}

	p.mu.Lock()
	defer p.mu.Unlock()
	spec, exists := p.panels[windowName]
	if !exists {
		return fmt.Errorf("panel window %q is not live", windowName)
	}
	record := p.transfers[windowName]
	if record.state != PanelWindowStateLive {
		return fmt.Errorf("panel window %q cannot dock from state %q", windowName, record.state)
	}
	if snapshot.OwnerWindowName != spec.OwnerWindowName ||
		snapshot.ClusterID != spec.ClusterID ||
		snapshot.GroupID != spec.GroupID {
		return fmt.Errorf("panel window %q cannot change owner, cluster, or group", windowName)
	}
	if _, used := p.usedIDs[snapshot.TransferID]; used {
		return fmt.Errorf("panel transfer %q already exists", snapshot.TransferID)
	}
	p.usedIDs[snapshot.TransferID] = struct{}{}
	p.transfers[windowName] = panelTransferRecord{
		state:      PanelWindowStateDocking,
		transferID: snapshot.TransferID,
		snapshot:   clonePanelGroupSnapshot(snapshot),
	}
	return nil
}

func (p *panelIndex) UpdateSnapshot(windowName string, snapshot PanelGroupSnapshot) error {
	if err := ValidatePanelGroupSnapshot(snapshot); err != nil {
		return err
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	spec, exists := p.panels[windowName]
	if !exists {
		return fmt.Errorf("panel window %q is not live", windowName)
	}
	record := p.transfers[windowName]
	if record.state != PanelWindowStateLive {
		return fmt.Errorf("panel window %q cannot update snapshot from state %q", windowName, record.state)
	}
	if snapshot.OwnerWindowName != spec.OwnerWindowName ||
		snapshot.ClusterID != spec.ClusterID || snapshot.GroupID != spec.GroupID {
		return fmt.Errorf("panel window %q cannot change owner, cluster, or group", windowName)
	}
	record.snapshot = clonePanelGroupSnapshot(snapshot)
	p.transfers[windowName] = record
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
	record, exists := p.transfers[windowName]
	if !exists {
		return fmt.Errorf("panel window %q is not live", windowName)
	}
	if record.transferID != transferID {
		return fmt.Errorf(
			"stale panel transfer %q for window %q",
			transferID,
			windowName,
		)
	}
	switch record.state {
	case PanelWindowStateOpening:
		p.removeLocked(windowName)
	case PanelWindowStateDocking:
		record.state = PanelWindowStateLive
		p.transfers[windowName] = record
	default:
		return fmt.Errorf(
			"panel window %q has no pending transfer in state %q",
			windowName,
			record.state,
		)
	}
	return nil
}

func (p *panelIndex) State(windowName string) PanelWindowState {
	p.mu.Lock()
	defer p.mu.Unlock()
	record, exists := p.transfers[windowName]
	if !exists {
		return PanelWindowStateMissing
	}
	return record.state
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

func (p *panelIndex) NamesOwnedBy(ownerWindowName, clusterID string) []string {
	p.mu.Lock()
	defer p.mu.Unlock()
	groups := p.ownerGroups[ownerWindowName]
	names := make([]string, 0, len(groups))
	for _, name := range groups {
		if clusterID == "" || p.panels[name].ClusterID == clusterID {
			names = append(names, name)
		}
	}
	sort.Strings(names)
	return names
}

func (p *panelIndex) addLocked(spec panelWindowSpec) (string, error) {
	groups := p.ownerGroups[spec.OwnerWindowName]
	if groups == nil {
		groups = make(map[string]string)
		p.ownerGroups[spec.OwnerWindowName] = groups
	}
	if existing := groups[spec.GroupID]; existing != "" {
		return "", fmt.Errorf(
			"owner workspace %q already owns panel group %q in window %q",
			spec.OwnerWindowName,
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

func (p *panelIndex) pendingLocked(
	windowName string,
	transferID string,
	want PanelWindowState,
) (panelTransferRecord, error) {
	record, exists := p.transfers[windowName]
	if !exists {
		return panelTransferRecord{}, fmt.Errorf("panel window %q is not live", windowName)
	}
	if record.state != want {
		return panelTransferRecord{}, fmt.Errorf(
			"panel window %q is in state %q, not %q",
			windowName,
			record.state,
			want,
		)
	}
	if record.transferID != transferID {
		return panelTransferRecord{}, fmt.Errorf(
			"stale panel transfer %q for window %q",
			transferID,
			windowName,
		)
	}
	return record, nil
}

func (p *panelIndex) descriptorLocked(windowName string) PanelWindowDescriptor {
	spec := p.panels[windowName]
	record := p.transfers[windowName]
	return PanelWindowDescriptor{
		WindowName:      windowName,
		OwnerWindowName: spec.OwnerWindowName,
		ClusterID:       spec.ClusterID,
		GroupID:         spec.GroupID,
		State:           record.state,
		Snapshot:        clonePanelGroupSnapshot(record.snapshot),
	}
}

func (p *panelIndex) removeLocked(windowName string) {
	spec, exists := p.panels[windowName]
	if !exists {
		return
	}
	delete(p.panels, windowName)
	delete(p.transfers, windowName)
	groups := p.ownerGroups[spec.OwnerWindowName]
	delete(groups, spec.GroupID)
	if len(groups) == 0 {
		delete(p.ownerGroups, spec.OwnerWindowName)
	}
}

func clonePanelGroupSnapshot(snapshot PanelGroupSnapshot) PanelGroupSnapshot {
	result := snapshot
	result.Tabs = append([]PanelTabSnapshot(nil), snapshot.Tabs...)
	if snapshot.InitialBounds != nil {
		bounds := *snapshot.InitialBounds
		result.InitialBounds = &bounds
	}
	return result
}
