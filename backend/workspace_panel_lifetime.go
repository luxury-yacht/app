package backend

import (
	"fmt"
	"github.com/luxury-yacht/app/internal/panelwindow"
	"strings"
)

func (a *WorkspaceCoordinator) PanelWorkspaceDirectory() *panelwindow.WorkspaceDirectory {
	a.panelWorkspaceOnce.Do(func() { a.panelWorkspace = panelwindow.NewWorkspaceDirectory() })
	return a.panelWorkspace
}

func (a *WorkspaceCoordinator) retainRemovedClusterViewsLocked(windowID string, selections []string) {
	remaining := make(map[string]struct{}, len(selections))
	for _, selection := range selections {
		remaining[selection] = struct{}{}
	}
	for _, previous := range a.workspaceSelections[windowID] {
		if _, keep := remaining[previous]; keep {
			continue
		}
		parsed, err := parseKubeconfigSelection(previous)
		if err == nil {
			a.PanelWorkspaceDirectory().RetainWindowCluster(windowID, a.clusterRuntime.clusterMetaForSelection(parsed).ID)
		}
	}
}

func (a *WorkspaceCoordinator) WindowClusterIDs(windowID string) []string {
	a.workspaceSelectionsMu.RLock()
	selections := append([]string(nil), a.workspaceSelections[windowID]...)
	a.workspaceSelectionsMu.RUnlock()
	ids := make([]string, 0, len(selections))
	for _, selection := range selections {
		parsed, err := parseKubeconfigSelection(selection)
		if err == nil {
			ids = append(ids, a.clusterRuntime.clusterMetaForSelection(parsed).ID)
		}
	}
	return ids
}

// RetainPanelCluster keeps a cluster selected while its shared panel workspace
// has a reference, independently of which app windows display cluster tabs.
func (a *WorkspaceCoordinator) RetainPanelCluster(referenceID, clusterID string) error {
	if strings.TrimSpace(referenceID) == "" || strings.TrimSpace(clusterID) == "" {
		return fmt.Errorf("panel retention requires reference and cluster identity")
	}
	return a.runOrderedSelectionMutation("retain-panel-cluster", func(_ *selectionMutation) error {
		selection := a.selectionForOpenCluster(clusterID)
		if selection == "" {
			return fmt.Errorf("panel cluster %q is not open", clusterID)
		}
		a.workspaceSelectionsMu.Lock()
		defer a.workspaceSelectionsMu.Unlock()
		if previous := a.panelSelections[referenceID]; previous != "" && previous != selection {
			return fmt.Errorf("panel reference %q cannot change cluster", referenceID)
		}
		if a.panelSelections == nil {
			a.panelSelections = make(map[string]string)
		}
		a.panelSelections[referenceID] = selection
		return nil
	})
}

func (a *WorkspaceCoordinator) selectionForOpenCluster(clusterID string) string {
	for _, selection := range a.GetSelectedKubeconfigs() {
		parsed, err := parseKubeconfigSelection(selection)
		if err == nil && a.clusterRuntime.clusterMetaForSelection(parsed).ID == clusterID {
			return selection
		}
	}
	return ""
}

func (a *WorkspaceCoordinator) ReleasePanelCluster(referenceID string) error {
	return a.runOrderedSelectionMutation("release-panel-cluster", func(mutation *selectionMutation) error {
		a.workspaceSelectionsMu.Lock()
		delete(a.panelSelections, referenceID)
		union := a.aggregateWorkspaceSelectionsLocked()
		a.workspaceSelectionsMu.Unlock()
		if selectionSetsEqual(union, a.GetSelectedKubeconfigs()) {
			return nil
		}
		return a.setSelectedKubeconfigs(mutation, union)
	})
}
