package backend

import (
	"encoding/json"
	"fmt"
	"maps"
	"slices"
	"strings"

	"github.com/luxury-yacht/app/internal/panelwindow"
)

type NamedWorkspace = panelwindow.NamedWorkspace
type NamedWorkspaceAppWindow = panelwindow.NamedWorkspaceAppWindow
type NamedWorkspacePanelWindow = panelwindow.NamedWorkspacePanelWindow
type NamedWorkspaceClusterTab = panelwindow.NamedWorkspaceClusterTab
type NamedWorkspaceGlobalView = panelwindow.NamedWorkspaceGlobalView
type NamedWorkspaceDockedGroup = panelwindow.NamedWorkspaceDockedGroup

func (s *UIStateStore) SaveNamedWorkspace(name string, workspace NamedWorkspace, replace bool) error {
	name = strings.TrimSpace(name)
	if name == "" {
		return fmt.Errorf("workspace name is required")
	}
	if err := validateNamedWorkspace(workspace); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	state, err := s.loadPersistenceFile()
	if err != nil {
		return err
	}
	if state.Workspaces == nil {
		state.Workspaces = make(map[string]NamedWorkspace)
	}
	if _, exists := state.Workspaces[name]; exists && !replace {
		return fmt.Errorf("workspace %q already exists", name)
	}
	state.Workspaces[name] = workspace
	return s.savePersistenceFile(state)
}

func (s *UIStateStore) ListNamedWorkspaces() ([]string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	state, err := s.loadPersistenceFile()
	if err != nil {
		return nil, err
	}
	return slices.Sorted(maps.Keys(state.Workspaces)), nil
}

func (s *UIStateStore) GetNamedWorkspace(name string) (*NamedWorkspace, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	state, err := s.loadPersistenceFile()
	if err != nil {
		return nil, err
	}
	workspace, ok := state.Workspaces[strings.TrimSpace(name)]
	if !ok {
		return nil, fmt.Errorf("workspace %q was not found", name)
	}
	if err := validateNamedWorkspace(workspace); err != nil {
		return nil, err
	}
	return &workspace, nil
}

func validateNamedWorkspace(workspace NamedWorkspace) error {
	if workspace.SchemaVersion != panelwindow.NamedWorkspaceSchemaVersion {
		return fmt.Errorf("unsupported workspace schema version %d", workspace.SchemaVersion)
	}
	if len(workspace.AppWindows) == 0 && len(workspace.PanelWindows) == 0 {
		return fmt.Errorf("workspace requires at least one window")
	}
	groups := make([]panelwindow.WorkspaceGroup, 0, len(workspace.PanelWindows))
	for index, window := range workspace.AppWindows {
		if err := validateNamedWorkspaceAppWindow(window); err != nil {
			return fmt.Errorf("app window %d: %w", index, err)
		}
		for _, dock := range window.DockedGroups {
			groups = append(groups, dock.Group)
		}
	}
	for index, window := range workspace.PanelWindows {
		if window.Geometry.Width <= 0 || window.Geometry.Height <= 0 {
			return fmt.Errorf("panel window %d requires positive width and height", index)
		}
		groups = append(groups, window.Group)
	}
	// The directory's panel identity rules apply across every saved placement.
	return panelwindow.ValidateWorkspaceGroups("saved workspace", panelwindow.PanelLocationWindow, groups)
}

func validateNamedWorkspaceAppWindow(window NamedWorkspaceAppWindow) error {
	if window.Geometry.Width <= 0 || window.Geometry.Height <= 0 {
		return fmt.Errorf("app window requires positive width and height")
	}
	clusters, err := validateNamedWorkspaceClusterTabs(window.ClusterTabs)
	if err != nil {
		return err
	}
	if _, selected := clusters[window.SelectedClusterID]; !selected && (len(clusters) > 0 || window.SelectedClusterID != "") {
		return fmt.Errorf("selected cluster %q is not in the app window", window.SelectedClusterID)
	}
	if window.GlobalView != nil && (len(clusters) < 2 || strings.TrimSpace(window.GlobalView.View) == "") {
		return fmt.Errorf("global view requires a view and at least two cluster tabs")
	}
	return validateNamedWorkspaceDockedGroups(window.DockedGroups, clusters)
}

func validateNamedWorkspaceClusterTabs(tabs []NamedWorkspaceClusterTab) (map[string]struct{}, error) {
	clusters := make(map[string]struct{}, len(tabs))
	for _, tab := range tabs {
		if _, duplicate := clusters[tab.ClusterID]; duplicate {
			return nil, fmt.Errorf("app window contains duplicate cluster %q", tab.ClusterID)
		}
		if err := validateNamedWorkspaceClusterTab(tab); err != nil {
			return nil, err
		}
		clusters[tab.ClusterID] = struct{}{}
	}
	return clusters, nil
}

func validateNamedWorkspaceClusterTab(tab NamedWorkspaceClusterTab) error {
	var view struct {
		ClusterID string `json:"clusterId"`
	}
	if err := json.Unmarshal(tab.ViewState, &view); err != nil {
		return fmt.Errorf("invalid view state for cluster %q: %w", tab.ClusterID, err)
	}
	if strings.TrimSpace(tab.ClusterID) == "" || view.ClusterID != tab.ClusterID {
		return fmt.Errorf("view state cluster %q does not match tab cluster %q", view.ClusterID, tab.ClusterID)
	}
	return nil
}

func validateNamedWorkspaceDockedGroups(docked []NamedWorkspaceDockedGroup, clusters map[string]struct{}) error {
	groups := make([]panelwindow.WorkspaceGroup, 0, len(docked))
	seen := make(map[[2]string]struct{}, len(docked))
	for _, dock := range docked {
		group := dock.Group
		if _, exists := clusters[group.ClusterID]; !exists {
			return fmt.Errorf("dock group %q belongs to cluster %q outside its app window", group.GroupID, group.ClusterID)
		}
		if dock.Width <= 0 || dock.Height <= 0 {
			return fmt.Errorf("dock group %q requires positive width and height", group.GroupID)
		}
		key := [2]string{group.ClusterID, group.GroupID}
		if _, duplicate := seen[key]; duplicate {
			return fmt.Errorf("duplicate dock group %q for cluster %q", group.GroupID, group.ClusterID)
		}
		seen[key] = struct{}{}
		groups = append(groups, group)
	}
	return panelwindow.ValidateWorkspaceGroups("saved workspace", panelwindow.PanelLocationDocked, groups)
}
