package panelwindow

import (
	"encoding/json"
	"fmt"
)

const NamedWorkspaceSchemaVersion = 1

const NamedWorkspaceCaptureRequested = "named-workspace:capture"
const NamedWorkspaceRestoreRequested = "named-workspace:restore"
const NamedWorkspaceMissingClusters = "named-workspace:missing-clusters"

type NamedWorkspaceMissingClustersEvent struct {
	WindowName string   `json:"windowName"`
	Clusters   []string `json:"clusters"`
}

type NamedWorkspaceRestoreRequest struct {
	WindowName string                  `json:"windowName"`
	Window     NamedWorkspaceAppWindow `json:"window"`
}

// StageNamedWorkspaceGroup installs a validated group in the isolated restore directory.
func (d *WorkspaceDirectory) StageNamedWorkspaceGroup(window string, kind PanelLocationKind, group WorkspaceGroup) error {
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

// CommitNamedWorkspace replaces presentation atomically after all staged views
// have mounted. Only identities that actually left lose their lifetime state.
func (d *WorkspaceDirectory) CommitNamedWorkspace(staged *WorkspaceDirectory, revision uint64) error {
	staged.mu.Lock()
	panels := make(map[workspacePanelKey]WorkspacePanel, len(staged.panels))
	for key, panel := range staged.panels {
		panels[key] = panel
	}
	stagedRevision := staged.revision
	staged.mu.Unlock()
	removal := &panelRemoval{}
	defer removal.report()
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.revision != revision || len(d.transfers) != 0 || len(d.reservations) != 0 {
		return fmt.Errorf("panel layout changed while opening the workspace")
	}
	for key, previous := range d.panels {
		if panel, exists := panels[key]; !exists || !previous.Tab.SameIdentity(panel.Tab) {
			removal.keys = append(removal.keys, PanelKey{ClusterID: key.clusterID, PanelID: key.panelID})
		}
	}
	removal.notify = d.onPanelsRemoved
	d.panels = panels
	d.revision = max(d.revision, stagedRevision) + 1
	return nil
}

type NamedWorkspaceCaptureRequest struct {
	ID         string `json:"id"`
	WindowName string `json:"windowName"`
}

type NamedWorkspaceGeometry struct {
	WindowBounds
	Maximized bool `json:"maximized"`
}

func (d *WorkspaceDirectory) WorkspaceCaptureRevision() (uint64, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	for _, panel := range d.panels {
		if panel.moving() {
			return 0, fmt.Errorf("wait for panel moves to finish before saving the workspace")
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

func (d *WorkspaceDirectory) RestoredWorkspaceClusters() []string {
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
