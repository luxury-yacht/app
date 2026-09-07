package panelwindow

import (
	"fmt"
	"sort"
	"sync"
)

type PanelLocationKind string

const (
	PanelLocationDocked   PanelLocationKind = "docked"
	PanelLocationWindow   PanelLocationKind = "panel-window"
	PanelLocationRetained PanelLocationKind = "retained"
)

// Location is presentation state. The object's cluster identity owns the panel.
type PanelLocation struct {
	Kind       PanelLocationKind `json:"kind"`
	WindowName string            `json:"windowName"`
	GroupID    string            `json:"groupId"`
	Index      int               `json:"index"`
	Active     bool              `json:"active"`
}

type WorkspacePanel struct {
	Tab      TabSnapshot   `json:"tab"`
	Location PanelLocation `json:"location"`
}

type WorkspaceSnapshot struct {
	Revision uint64           `json:"revision"`
	Panels   []WorkspacePanel `json:"panels"`
}

type WorkspaceGroup struct {
	ClusterID     string        `json:"clusterId"`
	GroupID       string        `json:"groupId"`
	Tabs          []TabSnapshot `json:"tabs"`
	ActivePanelID string        `json:"activePanelId"`
}

type PanelOpenResult struct {
	Panel  WorkspacePanel `json:"panel"`
	Render bool           `json:"render"`
}

type SharedWorkspaceCommands interface {
	ClusterPanelCloseCommands
	ClusterTabTransferCommands
	GetPanelWorkspace(string, string) (WorkspaceSnapshot, error)
	OpenPanelWorkspaceObject(string, TabSnapshot) (PanelOpenResult, error)
	PublishDockedPanels(string, []WorkspaceGroup) error
	AcknowledgePanelWorkspaceReady(string) error
}

const WorkspaceChangedEventName = "panel-workspace:changed"
const WorkspaceFocusRequestedEventName = "panel-workspace:focus-requested"

type WorkspaceChangedEvent struct {
	ClusterID string `json:"clusterId"`
}

type WorkspaceFocusRequestedEvent struct {
	ClusterID string `json:"clusterId"`
	PanelID   string `json:"panelId"`
}

type workspacePanelKey struct {
	clusterID string
	panelID   string
}

// WorkspaceDirectory holds the application-wide panel collection independently
// of the lifetime of any app-window renderer.
type WorkspaceDirectory struct {
	mu          sync.Mutex
	revision    uint64
	panels      map[workspacePanelKey]WorkspacePanel
	unpublished map[workspacePanelKey]struct{}
}

func NewWorkspaceDirectory() *WorkspaceDirectory {
	return &WorkspaceDirectory{panels: make(map[workspacePanelKey]WorkspacePanel), unpublished: make(map[workspacePanelKey]struct{})}
}

func validatePanelLocation(location PanelLocation) error {
	if location.Index < 0 || location.GroupID == "" {
		return fmt.Errorf("panel placement requires a group and nonnegative index")
	}
	switch location.Kind {
	case PanelLocationRetained:
		if location.WindowName != "" {
			return fmt.Errorf("retained panel cannot have a window")
		}
	case PanelLocationDocked:
		if location.GroupID != "right" && location.GroupID != "bottom" {
			return fmt.Errorf("docked panel requires a dock group")
		}
		if location.WindowName == "" {
			return fmt.Errorf("docked panel requires a window")
		}
	case PanelLocationWindow:
		if location.WindowName == "" {
			return fmt.Errorf("panel window placement requires a window")
		}
	default:
		return fmt.Errorf("unknown panel placement %q", location.Kind)
	}
	return nil
}

// Open atomically claims an object or returns its existing placement so another
// app window can focus it without creating a second panel.
func (d *WorkspaceDirectory) Open(tab TabSnapshot, location PanelLocation) (WorkspacePanel, bool, error) {
	if err := validateGroupTab(0, tab, tab.ObjectRef.ClusterID, make(map[string]struct{})); err != nil {
		return WorkspacePanel{}, false, err
	}
	if err := validatePanelLocation(location); err != nil {
		return WorkspacePanel{}, false, err
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	key := workspacePanelKey{tab.ObjectRef.ClusterID, tab.PanelID}
	if current, exists := d.panels[key]; exists && current.Tab.ObjectRef != tab.ObjectRef {
		return WorkspacePanel{}, false, fmt.Errorf("panel identity does not match its object")
	}
	for existingKey, current := range d.panels {
		if current.Tab.ObjectRef == tab.ObjectRef {
			key = existingKey
			break
		}
	}
	if existing, ok := d.panels[key]; ok {
		if existing.Tab.ObjectRef != tab.ObjectRef {
			return WorkspacePanel{}, false, fmt.Errorf("panel identity does not match its object")
		}
		if existing.Location.Kind == PanelLocationRetained {
			existing.Location = location
			d.panels[key] = existing
			d.unpublished[key] = struct{}{}
			d.revision++
			return existing, true, nil
		}
		return existing, false, nil
	}
	panel := WorkspacePanel{Tab: tab, Location: location}
	d.panels[key] = panel
	d.unpublished[key] = struct{}{}
	d.revision++
	return panel, true, nil
}

func (d *WorkspaceDirectory) RetainWindow(windowName string) {
	d.RetainWindowCluster(windowName, "")
}

func (d *WorkspaceDirectory) RetainWindowCluster(windowName, clusterID string) {
	d.mu.Lock()
	defer d.mu.Unlock()
	for key, panel := range d.panels {
		if panel.Location.WindowName != windowName || panel.Location.Kind != PanelLocationDocked {
			continue
		}
		if clusterID != "" && key.clusterID != clusterID {
			continue
		}
		panel.Location.Kind = PanelLocationRetained
		panel.Location.WindowName = ""
		d.panels[key] = panel
		d.revision++
	}
}

func (d *WorkspaceDirectory) RetainPanelWindow(windowName string) {
	d.mu.Lock()
	defer d.mu.Unlock()
	for key, panel := range d.panels {
		if panel.Location.WindowName != windowName {
			continue
		}
		panel.Location = PanelLocation{Kind: PanelLocationRetained, GroupID: "right", Index: panel.Location.Index, Active: panel.Location.Active}
		d.panels[key] = panel
		d.revision++
	}
}

func (d *WorkspaceDirectory) Move(tab TabSnapshot, source, target PanelLocation) error {
	if err := validatePanelLocation(target); err != nil {
		return err
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	key := workspacePanelKey{tab.ObjectRef.ClusterID, tab.PanelID}
	panel, ok := d.panels[key]
	if !ok || panel.Tab != tab || panel.Location != source {
		return fmt.Errorf("panel transfer source is stale")
	}
	panel.Location = target
	d.panels[key] = panel
	d.revision++
	return nil
}

func (d *WorkspaceDirectory) RemoveWindow(windowName string) {
	d.mu.Lock()
	defer d.mu.Unlock()
	for key, panel := range d.panels {
		if panel.Location.WindowName == windowName {
			delete(d.panels, key)
			delete(d.unpublished, key)
			d.revision++
		}
	}
}

// TransferGroup commits an acknowledged handoff as one directory mutation.
// A closed source may have retained its tabs while the destination was mounting.
func (d *WorkspaceDirectory) TransferGroup(sourceWindow, targetWindow string, kind PanelLocationKind, group WorkspaceGroup) error {
	next, err := panelsFromGroups(targetWindow, kind, []WorkspaceGroup{group})
	if err != nil {
		return err
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	for key, panel := range next {
		current, exists := d.panels[key]
		if !exists || current.Tab != panel.Tab || (current.Location.WindowName != sourceWindow && current.Location.Kind != PanelLocationRetained) {
			return fmt.Errorf("panel group transfer source is stale")
		}
	}
	if kind == PanelLocationDocked {
		d.appendPlacementsLocked(targetWindow, next)
	}
	for key, panel := range next {
		d.panels[key] = panel
		delete(d.unpublished, key)
	}
	d.revision++
	return nil
}

func (d *WorkspaceDirectory) RestoreTransferredPanels(targetWindow string, previous []WorkspacePanel) {
	d.mu.Lock()
	defer d.mu.Unlock()
	for _, panel := range previous {
		key := workspacePanelKey{panel.Tab.ObjectRef.ClusterID, panel.Tab.PanelID}
		current, exists := d.panels[key]
		if exists && current.Location.WindowName == targetWindow && current.Tab == panel.Tab {
			d.panels[key] = panel
			d.revision++
		}
	}
}

func panelsFromGroups(windowName string, kind PanelLocationKind, groups []WorkspaceGroup) (map[workspacePanelKey]WorkspacePanel, error) {
	panels := make(map[workspacePanelKey]WorkspacePanel)
	objects := make(map[ObjectReference]struct{})
	for _, group := range groups {
		location := PanelLocation{Kind: kind, WindowName: windowName, GroupID: group.GroupID}
		if err := validatePanelLocation(location); err != nil {
			return nil, err
		}
		if err := validateGroupTabs(GroupSnapshot{ClusterID: group.ClusterID, Tabs: group.Tabs, ActivePanelID: group.ActivePanelID}); err != nil {
			return nil, err
		}
		if err := addWorkspaceGroupPanels(group, location, panels, objects); err != nil {
			return nil, err
		}
	}
	return panels, nil
}

func ValidateWorkspaceGroups(windowName string, kind PanelLocationKind, groups []WorkspaceGroup) error {
	_, err := panelsFromGroups(windowName, kind, groups)
	return err
}

// PublishWindow reconciles only the publishing renderer's groups. Validation
// precedes writes so a rejected snapshot cannot partially remove its panels.
type PlacementTransfer struct {
	TransferID       string
	Tab              TabSnapshot
	SourceWindowName string
	SourceGroupID    string
	TargetGroupID    string
}

func (d *WorkspaceDirectory) PublishWindow(windowName string, kind PanelLocationKind, groups []WorkspaceGroup) error {
	_, err := d.PublishWindowWithTransfers(windowName, kind, groups, nil)
	return err
}

// Snapshot publication and acknowledged tab placement share one commit. Invalid
// target content cannot move a source tab before the publication is rejected.
func (d *WorkspaceDirectory) PublishWindowWithTransfers(windowName string, kind PanelLocationKind, groups []WorkspaceGroup, transfers []PlacementTransfer) ([]string, error) {
	if windowName == "" || (kind != PanelLocationDocked && kind != PanelLocationWindow) {
		return nil, fmt.Errorf("panel publication requires a live renderer")
	}
	next, err := panelsFromGroups(windowName, kind, groups)
	if err != nil {
		return nil, err
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	approved := make(map[workspacePanelKey]PlacementTransfer)
	for _, transfer := range transfers {
		approved[workspacePanelKey{transfer.Tab.ObjectRef.ClusterID, transfer.Tab.PanelID}] = transfer
	}
	if err := d.validatePublicationLocked(windowName, next, approved); err != nil {
		return nil, err
	}
	d.replacePublishedWindowLocked(windowName, next)
	committed := make([]string, 0, len(transfers))
	for _, transfer := range transfers {
		panel, found := next[workspacePanelKey{transfer.Tab.ObjectRef.ClusterID, transfer.Tab.PanelID}]
		if found && panel.Tab == transfer.Tab && panel.Location.GroupID == transfer.TargetGroupID {
			committed = append(committed, transfer.TransferID)
		}
	}
	d.revision++
	return committed, nil
}

func validPublicationTransfer(previous, next WorkspacePanel, transfer PlacementTransfer) bool {
	return transfer.TransferID != "" && previous.Tab == transfer.Tab && next.Tab == transfer.Tab &&
		previous.Location.WindowName == transfer.SourceWindowName && previous.Location.GroupID == transfer.SourceGroupID && next.Location.GroupID == transfer.TargetGroupID
}

func (d *WorkspaceDirectory) validatePublicationLocked(windowName string, next map[workspacePanelKey]WorkspacePanel, approved map[workspacePanelKey]PlacementTransfer) error {
	for key, panel := range next {
		previous, exists := d.panels[key]
		if transfer, transferring := approved[key]; transferring {
			if !exists || !validPublicationTransfer(previous, panel, transfer) {
				return fmt.Errorf("panel transfer source is stale")
			}
		} else if exists && (previous.Location.WindowName != windowName || previous.Tab.ObjectRef != panel.Tab.ObjectRef) {
			return fmt.Errorf("panel %q is owned by another placement", key.panelID)
		}
		if err := d.validateObjectIdentityLocked(key, panel.Tab.ObjectRef); err != nil {
			return err
		}
	}
	return nil
}

func (d *WorkspaceDirectory) validateObjectIdentityLocked(key workspacePanelKey, ref ObjectReference) error {
	for existingKey, panel := range d.panels {
		if existingKey != key && panel.Tab.ObjectRef == ref {
			return fmt.Errorf("object already has panel %q", existingKey.panelID)
		}
	}
	return nil
}

func (d *WorkspaceDirectory) Snapshot(clusterID string) WorkspaceSnapshot {
	d.mu.Lock()
	defer d.mu.Unlock()
	snapshot := WorkspaceSnapshot{Revision: d.revision, Panels: []WorkspacePanel{}}
	for key, panel := range d.panels {
		if key.clusterID == clusterID {
			snapshot.Panels = append(snapshot.Panels, panel)
		}
	}
	sort.Slice(snapshot.Panels, func(i, j int) bool { return snapshot.Panels[i].Tab.PanelID < snapshot.Panels[j].Tab.PanelID })
	return snapshot
}

func addWorkspaceGroupPanels(group WorkspaceGroup, location PanelLocation, panels map[workspacePanelKey]WorkspacePanel, objects map[ObjectReference]struct{}) error {
	for index, tab := range group.Tabs {
		key := workspacePanelKey{group.ClusterID, tab.PanelID}
		if _, exists := panels[key]; exists {
			return fmt.Errorf("panel %q appears in multiple groups", tab.PanelID)
		}
		if _, duplicate := objects[tab.ObjectRef]; duplicate {
			return fmt.Errorf("object appears in multiple panel tabs")
		}
		objects[tab.ObjectRef] = struct{}{}
		location.Index = index
		location.Active = tab.PanelID == group.ActivePanelID
		panels[key] = WorkspacePanel{Tab: tab, Location: location}
	}
	return nil
}

func (d *WorkspaceDirectory) replacePublishedWindowLocked(windowName string, next map[workspacePanelKey]WorkspacePanel) {
	for key, panel := range d.panels {
		_, awaitingMount := d.unpublished[key]
		if panel.Location.WindowName == windowName && !awaitingMount {
			delete(d.panels, key)
		}
	}
	for key, panel := range next {
		d.panels[key] = panel
		delete(d.unpublished, key)
	}
}

// RemoveCluster discards the shared panel collection after all renderers have
// approved an explicit close of the cluster's final app tab.
func (d *WorkspaceDirectory) RemoveCluster(clusterID string) {
	d.mu.Lock()
	defer d.mu.Unlock()
	for key := range d.panels {
		if key.clusterID == clusterID {
			delete(d.panels, key)
			delete(d.unpublished, key)
			d.revision++
		}
	}
}
