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
	Transfer PanelTransfer `json:"transfer,omitempty,omitzero"`
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
	OpenClusterWindow(string, string) error
	GetPanelWorkspace(string, string) (WorkspaceSnapshot, error)
	OpenPanelWorkspaceObject(string, TabSnapshot) (PanelOpenResult, error)
	ClosePanelWorkspaceObject(string, string, string) error
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

// PanelKey identifies a panel across windows for owners of panel-lifetime state.
type PanelKey struct {
	ClusterID string
	PanelID   string
}

// panelRemoval collects panels that left the directory and reports them after the caller
// releases d.mu, so a handler may call back into its own locks without a cycle.
type panelRemoval struct {
	keys   []PanelKey
	notify func([]PanelKey)
}

func (r *panelRemoval) report() {
	if r.notify != nil && len(r.keys) > 0 {
		r.notify(r.keys)
	}
}

// WorkspaceDirectory holds the application-wide panel collection independently
// of the lifetime of any app-window renderer.
type WorkspaceDirectory struct {
	mu               sync.Mutex
	revision         uint64
	panels           map[workspacePanelKey]WorkspacePanel
	onClusterRemoved func(string)
	onPanelsRemoved  func([]PanelKey)
	reservations     map[uint64]string
	nextReservation  uint64
	transfers        map[string][]workspacePanelKey
}

func NewWorkspaceDirectory() *WorkspaceDirectory {
	return &WorkspaceDirectory{panels: make(map[workspacePanelKey]WorkspacePanel)}
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
func (d *WorkspaceDirectory) Open(tab TabSnapshot, location PanelLocation, reservations ...*WorkspaceReservation) (WorkspacePanel, bool, error) {
	if err := validateGroupTab(0, tab, tab.ClusterID(), make(map[string]struct{})); err != nil {
		return WorkspacePanel{}, false, err
	}
	if err := validatePanelLocation(location); err != nil {
		return WorkspacePanel{}, false, err
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	if err := d.validateReservationsLocked(reservations); err != nil {
		return WorkspacePanel{}, false, err
	}
	key := workspacePanelKey{tab.ClusterID(), tab.PanelID}
	if current, exists := d.panels[key]; exists && current.Tab.identity() != tab.identity() {
		return WorkspacePanel{}, false, fmt.Errorf("panel identity does not match its object")
	}
	for existingKey, current := range d.panels {
		if current.Tab.identity() == tab.identity() {
			key = existingKey
			break
		}
	}
	if existing, ok := d.panels[key]; ok {
		if existing.Location.Kind == PanelLocationRetained && !existing.moving() {
			existing.Location = location
			d.panels[key] = existing
			d.revision++
			return existing, true, nil
		}
		return existing, false, nil
	}
	panel := WorkspacePanel{Tab: tab, Location: location}
	d.panels[key] = panel
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

func (d *WorkspaceDirectory) RemoveWindow(windowName string) {
	removal := &panelRemoval{}
	defer removal.report()
	d.mu.Lock()
	defer d.mu.Unlock()
	for key, panel := range d.panels {
		if panel.Location.WindowName == windowName {
			d.deletePanelLocked(key, removal)
			d.revision++
		}
	}
}

// ClosePanel removes a panel its renderer closed. A panel the directory has
// since placed elsewhere, or is moving, is not that renderer's to close.
func (d *WorkspaceDirectory) ClosePanel(windowName, clusterID, panelID string) bool {
	removal := &panelRemoval{}
	defer removal.report()
	d.mu.Lock()
	defer d.mu.Unlock()
	key := workspacePanelKey{clusterID, panelID}
	panel, exists := d.panels[key]
	if !exists || panel.Location.WindowName != windowName || panel.moving() {
		return false
	}
	d.deletePanelLocked(key, removal)
	d.revision++
	return true
}

// SetPanelRemovalHandler installs the owner of panel-lifetime state. It is told which panels
// closed (removed from every window), never about moves between windows.
func (d *WorkspaceDirectory) SetPanelRemovalHandler(handler func([]PanelKey)) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.onPanelsRemoved = handler
}

// HasPanel reports whether a panel is open in any window, including retained placements.
func (d *WorkspaceDirectory) HasPanel(clusterID, panelID string) bool {
	d.mu.Lock()
	defer d.mu.Unlock()
	_, ok := d.panels[workspacePanelKey{clusterID, panelID}]
	return ok
}

func (d *WorkspaceDirectory) deletePanelLocked(key workspacePanelKey, removal *panelRemoval) {
	d.leaveTransferLocked(key)
	delete(d.panels, key)
	removal.keys = append(removal.keys, PanelKey{ClusterID: key.clusterID, PanelID: key.panelID})
	removal.notify = d.onPanelsRemoved
}

func panelsFromGroups(windowName string, kind PanelLocationKind, groups []WorkspaceGroup) (map[workspacePanelKey]WorkspacePanel, error) {
	panels := make(map[workspacePanelKey]WorkspacePanel)
	objects := make(map[panelIdentity]struct{})
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

// PublishWindow reports a renderer's arrangement of the panels the directory
// places in it: edge, order, activation, and each tab's view. It never opens,
// closes, claims, or moves a panel; those are directory commands. Malformed
// input is rejected before anything changes.
func (d *WorkspaceDirectory) PublishWindow(windowName string, kind PanelLocationKind, groups []WorkspaceGroup, reservations ...*WorkspaceReservation) error {
	if windowName == "" || (kind != PanelLocationDocked && kind != PanelLocationWindow) {
		return fmt.Errorf("panel publication requires a live renderer")
	}
	next, err := panelsFromGroups(windowName, kind, groups)
	if err != nil {
		return err
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	if err := d.validateReservationsLocked(reservations); err != nil {
		return err
	}
	for key, arranged := range next {
		current, exists := d.panels[key]
		if !exists || current.Location.WindowName != windowName || current.Location.Kind != kind ||
			current.moving() || current.Tab.identity() != arranged.Tab.identity() {
			continue
		}
		current.Tab, current.Location = arranged.Tab, arranged.Location
		d.panels[key] = current
	}
	d.revision++
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

func addWorkspaceGroupPanels(group WorkspaceGroup, location PanelLocation, panels map[workspacePanelKey]WorkspacePanel, objects map[panelIdentity]struct{}) error {
	for index, tab := range group.Tabs {
		key := workspacePanelKey{group.ClusterID, tab.PanelID}
		if _, exists := panels[key]; exists {
			return fmt.Errorf("panel %q appears in multiple groups", tab.PanelID)
		}
		if _, duplicate := objects[tab.identity()]; duplicate {
			return fmt.Errorf("object appears in multiple panel tabs")
		}
		objects[tab.identity()] = struct{}{}
		location.Index = index
		location.Active = tab.PanelID == group.ActivePanelID
		panels[key] = WorkspacePanel{Tab: tab, Location: location}
	}
	return nil
}

// SetClusterRemovalHandler installs the process registry's non-blocking removal
// notification. The handler must enqueue native cleanup, not wait on selection.
func (d *WorkspaceDirectory) SetClusterRemovalHandler(handler func(string)) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.onClusterRemoved = handler
}

// RemoveCluster discards panels for both explicit closure and runtime removal.
func (d *WorkspaceDirectory) RemoveCluster(clusterID string) {
	removal := &panelRemoval{}
	defer removal.report()
	d.mu.Lock()
	for key := range d.panels {
		if key.clusterID == clusterID {
			d.deletePanelLocked(key, removal)
			d.revision++
		}
	}
	for id, reserved := range d.reservations {
		if reserved == clusterID {
			delete(d.reservations, id)
		}
	}
	notify := d.onClusterRemoved
	d.mu.Unlock()
	if notify != nil {
		notify(clusterID)
	}
}
