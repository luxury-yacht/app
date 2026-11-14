package panelwindow

import (
	"encoding/json"
	"fmt"
)

const NamedWorkspaceSchemaVersion = 1

const NamedWorkspaceCaptureRequested = "named-workspace:capture"
const NamedWorkspaceRestoreRequested = "named-workspace:restore"
const NamedWorkspaceWarnings = "named-workspace:warnings"

// NamedWorkspaceWarningsEvent tells one window of a newly opened workspace what
// the switch could not do. The window that asked for the switch is usually one
// of those it closed, so it cannot be the one to show this.
type NamedWorkspaceWarningsEvent struct {
	WindowName string `json:"windowName"`
	// MissingClusters are saved clusters that are no longer available.
	MissingClusters []string `json:"missingClusters"`
	// UnclosedWindows counts previous windows that did not close.
	UnclosedWindows int `json:"unclosedWindows"`
	// UnrestoredWindows counts saved windows that could not be opened or did not
	// load their saved view.
	UnrestoredWindows int `json:"unrestoredWindows"`
	// NotFullscreen counts restored windows that did not return to fullscreen.
	NotFullscreen int `json:"notFullscreen"`
}

type NamedWorkspaceRestoreRequest struct {
	WindowName string                  `json:"windowName"`
	Window     NamedWorkspaceAppWindow `json:"window"`
}

// PlaceNamedWorkspaceGroup places a saved group for the window that is about
// to show it. A panel another window already holds is refused.
func (d *WorkspaceDirectory) PlaceNamedWorkspaceGroup(window string, kind PanelLocationKind, group WorkspaceGroup) error {
	panels, err := panelsFromGroups(window, kind, []WorkspaceGroup{group})
	if err != nil {
		return err
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	for key := range panels {
		if _, exists := d.panels[key]; exists {
			return fmt.Errorf("duplicate workspace panel %q", key.panelID)
		}
	}
	for key, panel := range panels {
		d.panels[key] = panel
	}
	d.revision++
	return nil
}

// ClearForNamedWorkspace sets every panel aside so a saved workspace can take
// the directory. It refuses if anything changed since revision was read, or
// while a move or an open is still in flight. The caller finishes with either
// CloseClearedWorkspace or RestoreClearedWorkspace.
func (d *WorkspaceDirectory) ClearForNamedWorkspace(revision uint64) error {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.revision != revision || len(d.transfers) != 0 || len(d.reservations) != 0 {
		return fmt.Errorf("panel layout changed while opening the workspace")
	}
	d.setAside = d.panels
	d.panels = make(map[workspacePanelKey]WorkspacePanel)
	d.revision++
	return nil
}

// CloseClearedWorkspace is for a switch that goes ahead. It tells the owner of
// panel-lifetime state that the set-aside panels have closed, except those the
// saved workspace opened again.
func (d *WorkspaceDirectory) CloseClearedWorkspace() {
	removal := &panelRemoval{}
	defer removal.report()
	d.mu.Lock()
	defer d.mu.Unlock()
	d.dropSetAsideLocked(removal, func(key workspacePanelKey, _ WorkspacePanel) bool {
		_, reopened := d.panels[key]
		return !reopened
	})
	d.setAside = nil
}

// RestoreClearedWorkspace puts the set-aside panels back. It is for a switch
// that could not create a single saved window. Panels whose window or cluster
// went meanwhile are no longer set aside, so they do not come back.
func (d *WorkspaceDirectory) RestoreClearedWorkspace() {
	d.mu.Lock()
	defer d.mu.Unlock()
	for key, panel := range d.setAside {
		if _, exists := d.panels[key]; !exists {
			d.panels[key] = panel
		}
	}
	d.setAside = nil
	d.revision++
}

type NamedWorkspaceCaptureRequest struct {
	ID         string `json:"id"`
	WindowName string `json:"windowName"`
}

// NamedWorkspaceGeometry is where a window sits in its normal state, and the
// state it was saved in. Minimized combines with either of the others; a
// fullscreen window is not also recorded as maximized.
type NamedWorkspaceGeometry struct {
	WindowBounds
	Maximized  bool `json:"maximized"`
	Fullscreen bool `json:"fullscreen"`
	Minimized  bool `json:"minimized"`
}

func (d *WorkspaceDirectory) WorkspaceCaptureRevision() (uint64, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	for _, panel := range d.panels {
		if panel.moving() {
			return 0, fmt.Errorf("wait for panel moves to finish")
		}
	}
	return d.revision, nil
}

func (d *WorkspaceDirectory) DockedGroups(clusterID, windowName string) []WorkspaceGroup {
	d.mu.Lock()
	defer d.mu.Unlock()
	held := make(map[workspacePanelKey]WorkspacePanel)
	for key, panel := range d.panels {
		if key.clusterID == clusterID && panel.Location.Kind == PanelLocationDocked && panel.Location.WindowName == windowName {
			held[key] = panel
		}
	}
	return viewGroups(clusterID, held)
}

// NamedWorkspace describes durable desktop state. Each app window owns its
// views, so opening a cluster twice preserves the two independent arrangements.
type NamedWorkspace struct {
	SchemaVersion int                         `json:"schemaVersion"`
	AppWindows    []NamedWorkspaceAppWindow   `json:"appWindows"`
	PanelWindows  []NamedWorkspacePanelWindow `json:"panelWindows"`
	// Revision identifies this saved snapshot. A name can be deleted and reused,
	// so a change to a saved workspace names the revision it was listed with.
	Revision string `json:"revision,omitempty"`
}

// NamedWorkspaceEntry is one saved workspace as a dialog lists it.
type NamedWorkspaceEntry struct {
	Name     string `json:"name"`
	Revision string `json:"revision"`
}

type NamedWorkspaceAppWindow struct {
	Geometry NamedWorkspaceGeometry `json:"geometry"`
	NamedWorkspaceAppView
}

// NamedWorkspaceAppView is the part of an app window that its renderer owns and
// reports during capture. The registry adds the native geometry.
type NamedWorkspaceAppView struct {
	SelectedClusterID string                      `json:"selectedClusterId,omitempty"`
	ClusterTabs       []NamedWorkspaceClusterTab  `json:"clusterTabs"`
	GlobalView        *NamedWorkspaceGlobalView   `json:"globalView,omitempty"`
	DockedGroups      []NamedWorkspaceDockedGroup `json:"dockedGroups,omitempty"`
}

type NamedWorkspaceClusterTab struct {
	ClusterID string          `json:"clusterId"`
	ViewState json.RawMessage `json:"viewState"`
}

type NamedWorkspaceGlobalView struct {
	View   string                     `json:"view"`
	Tables map[string]json.RawMessage `json:"tables,omitempty"`
}

type NamedWorkspaceDockedGroup struct {
	Group     WorkspaceGroup `json:"group"`
	Width     float64        `json:"width"`
	Height    float64        `json:"height"`
	Maximized bool           `json:"maximized"`
}

type NamedWorkspacePanelWindow struct {
	Geometry NamedWorkspaceGeometry `json:"geometry"`
	Group    WorkspaceGroup         `json:"group"`
}

// PanelClusters lists the clusters that have a panel in any window.
func (d *WorkspaceDirectory) PanelClusters() []string {
	d.mu.Lock()
	defer d.mu.Unlock()
	clusters := map[string]bool{}
	for key := range d.panels {
		clusters[key.clusterID] = true
	}
	result := make([]string, 0, len(clusters))
	for cluster := range clusters {
		result = append(result, cluster)
	}
	return result
}
