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

// panelGroupTransfer is a native window's pending open or dock. The directory
// move it releases is the only record of where the panels go; this record only
// tracks the native side (window state, opening source, timeout).
type panelGroupTransfer struct {
	windowName string
	state      PanelWindowState
	// source is the renderer an opening window's group comes from.
	source string
	// release cancels the directory-owned placement move. Every native transfer
	// ends in finishLocked, so a failed or abandoned transfer cannot pin panels.
	release func()
}

type panelIndex struct {
	mu            sync.Mutex
	next          uint64
	panels        map[string]panelWindowSpec
	clusterGroups map[string]map[string]string
	transfers     transferLifecycle[panelGroupTransfer]
}

func newPanelIndex() *panelIndex {
	return &panelIndex{
		panels:        make(map[string]panelWindowSpec),
		clusterGroups: make(map[string]map[string]string),
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
	if err := p.transfers.begin(snapshot.TransferID, &panelGroupTransfer{windowName: name, state: PanelWindowStateOpening, source: snapshot.SourceWindowName}, transferAwaitingTarget); err != nil {
		p.removeLocked(name)
		return PanelWindowDescriptor{}, err
	}
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
	p.finishLocked(transferID)
	return p.descriptorLocked(windowName), nil
}

// Pending validates a transfer without finishing it, so the caller can commit
// directory placement before the native transfer ends.
func (p *panelIndex) Pending(windowName, transferID string, state PanelWindowState) (PanelWindowDescriptor, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if _, err := p.pendingLocked(windowName, transferID, state); err != nil {
		return PanelWindowDescriptor{}, err
	}
	return p.descriptorLocked(windowName), nil
}

func (p *panelIndex) attachRelease(windowName, transferID string, release func()) {
	p.mu.Lock()
	defer p.mu.Unlock()
	transfer := p.transfers.get(transferID)
	if transfer == nil || transfer.windowName != windowName {
		release()
		return
	}
	transfer.release = release
}

// OpeningSource names the renderer an opening window's group comes from; it is
// empty once the window is live.
func (p *panelIndex) OpeningSource(windowName string) string {
	p.mu.Lock()
	defer p.mu.Unlock()
	if _, transfer := p.windowTransferLocked(windowName); transfer != nil && transfer.state == PanelWindowStateOpening {
		return transfer.source
	}
	return ""
}

func (p *panelIndex) finishLocked(transferID string) {
	if transfer := p.transfers.finish(transferID); transfer != nil && transfer.release != nil {
		transfer.release()
	}
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
	return p.transfers.begin(snapshot.TransferID, &panelGroupTransfer{windowName: windowName, state: PanelWindowStateDocking}, transferAwaitingTarget)
}

// ValidatePublication admits a live window's arrangement report for its own
// cluster and group. The report is not stored here.
func (p *panelIndex) ValidatePublication(windowName string, group panelwindow.WorkspaceGroup) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	spec, exists := p.panels[windowName]
	if !exists {
		return fmt.Errorf("panel window %q is not live", windowName)
	}
	if state := p.stateLocked(windowName); state != PanelWindowStateLive {
		return fmt.Errorf("panel window %q cannot publish from state %q", windowName, state)
	}
	if group.ClusterID != spec.ClusterID || group.GroupID != spec.GroupID {
		return fmt.Errorf("panel window %q cannot change cluster or group", windowName)
	}
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
	if _, exists := p.panels[windowName]; !exists {
		return fmt.Errorf("panel window %q is not live", windowName)
	}
	pendingID, transfer := p.windowTransferLocked(windowName)
	if transfer == nil {
		return fmt.Errorf("panel window %q has no pending transfer in state %q", windowName, PanelWindowStateLive)
	}
	if pendingID != transferID {
		return fmt.Errorf("stale panel transfer %q for window %q", transferID, windowName)
	}
	if transfer.state == PanelWindowStateOpening {
		p.removeLocked(windowName)
	} else {
		p.finishLocked(transferID)
	}
	return nil
}

func (p *panelIndex) State(windowName string) PanelWindowState {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.stateLocked(windowName)
}

func (p *panelIndex) stateLocked(windowName string) PanelWindowState {
	if _, exists := p.panels[windowName]; !exists {
		return PanelWindowStateMissing
	}
	if _, transfer := p.windowTransferLocked(windowName); transfer != nil {
		return transfer.state
	}
	return PanelWindowStateLive
}

// A window has at most one pending transfer: BeginOpen creates the window with
// it, and BeginDock requires a live window.
func (p *panelIndex) windowTransferLocked(windowName string) (string, *panelGroupTransfer) {
	for id, transfer := range p.transfers.all() {
		if transfer.windowName == windowName {
			return id, transfer
		}
	}
	return "", nil
}

func (p *panelIndex) setTransferTimeout(windowName, transferID string, duration time.Duration, expire func()) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if pendingID, transfer := p.windowTransferLocked(windowName); transfer != nil && pendingID == transferID {
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
	if _, exists := p.panels[windowName]; !exists {
		return nil, fmt.Errorf("panel window %q is not live", windowName)
	}
	state := p.stateLocked(windowName)
	if state != want {
		return nil, fmt.Errorf("panel window %q is in state %q, not %q", windowName, state, want)
	}
	pendingID, transfer := p.windowTransferLocked(windowName)
	if pendingID != transferID {
		return nil, fmt.Errorf("stale panel transfer %q for window %q", transferID, windowName)
	}
	return transfer, nil
}

// descriptorLocked carries identity and transfer state; the registry adds the
// group from the directory.
func (p *panelIndex) descriptorLocked(windowName string) PanelWindowDescriptor {
	spec := p.panels[windowName]
	transferID, _ := p.windowTransferLocked(windowName)
	return PanelWindowDescriptor{
		WindowName: windowName,
		ClusterID:  spec.ClusterID,
		GroupID:    spec.GroupID,
		State:      p.stateLocked(windowName),
		TransferID: transferID,
	}
}

func (p *panelIndex) removeLocked(windowName string) {
	spec, exists := p.panels[windowName]
	if !exists {
		return
	}
	if transferID, transfer := p.windowTransferLocked(windowName); transfer != nil {
		p.finishLocked(transferID)
	}
	delete(p.panels, windowName)
	groups := p.clusterGroups[spec.ClusterID]
	delete(groups, spec.GroupID)
	if len(groups) == 0 {
		delete(p.clusterGroups, spec.ClusterID)
	}
}

// TransferWindow names the native window a pending group transfer belongs to.
func (p *panelIndex) TransferWindow(transferID string) (string, bool) {
	p.mu.Lock()
	defer p.mu.Unlock()
	transfer := p.transfers.get(transferID)
	if transfer == nil {
		return "", false
	}
	return transfer.windowName, true
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
