package backend

import (
	"fmt"
	"slices"
	"strings"

	"github.com/luxury-yacht/app/internal/panelwindow"
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
	if a == nil {
		return fmt.Errorf("app is nil")
	}
	finish := a.beginSelectionMutationDrain()
	defer finish()
	if handled, err := a.retainOwnedPanelCluster(referenceID, clusterID); handled {
		return err
	}
	return a.runOrderedSelectionMutation("retain-panel-cluster", func(_ *selectionMutation) error {
		selection := a.selectionForOpenCluster(clusterID)
		if selection == "" {
			return fmt.Errorf("panel cluster %q is not open", clusterID)
		}
		a.workspaceSelectionsMu.Lock()
		defer a.workspaceSelectionsMu.Unlock()
		return a.retainPanelSelectionLocked(referenceID, selection)
	})
}

// Adding a reference to an already-owned selection does not change the
// process union. Check ownership and retain under the same short lock so a
// concurrent last-owner removal cannot commit a union that drops this panel.
func (a *WorkspaceCoordinator) retainOwnedPanelCluster(referenceID, clusterID string) (bool, error) {
	a.workspaceSelectionsMu.Lock()
	defer a.workspaceSelectionsMu.Unlock()
	selection := a.selectionForOpenCluster(clusterID)
	if selection == "" || !a.selectionHasOwnerLocked(selection, "") {
		return false, nil
	}
	return true, a.retainPanelSelectionLocked(referenceID, selection)
}

func (a *WorkspaceCoordinator) retainPanelSelectionLocked(referenceID, selection string) error {
	if previous := a.panelSelections[referenceID]; previous != "" && previous != selection {
		return fmt.Errorf("panel reference %q cannot change cluster", referenceID)
	}
	if a.panelSelections == nil {
		a.panelSelections = make(map[string]string)
	}
	a.panelSelections[referenceID] = selection
	return nil
}

// The caller holds workspaceSelectionsMu. An excluded panel reference cannot
// provide the ownership that allows its own removal to bypass runtime teardown.
func (a *WorkspaceCoordinator) selectionHasOwnerLocked(selection, excludedReference string) bool {
	for _, owned := range a.workspaceSelections {
		if slices.Contains(owned, selection) {
			return true
		}
	}
	for reference, owned := range a.panelSelections {
		if reference != excludedReference && owned == selection {
			return true
		}
	}
	return false
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
	if a == nil {
		return fmt.Errorf("app is nil")
	}
	finish := a.beginSelectionMutationDrain()
	defer finish()
	if a.releaseOwnedPanelCluster(referenceID) {
		return nil
	}

	return a.runOrderedSelectionMutation("release-panel-cluster", func(mutation *selectionMutation) error {
		if clusterID, shared := strings.CutPrefix(referenceID, "panel-workspace:"); shared && a.PanelWorkspaceDirectory().HasClusterReference(clusterID) {
			return nil
		}
		a.workspaceSelectionsMu.Lock()
		delete(a.panelSelections, referenceID)
		mutation.preserveRestartSelection = len(a.workspaceSelections) == 0
		union := a.aggregateWorkspaceSelectionsLocked()
		a.workspaceSelectionsMu.Unlock()
		if selectionSetsEqual(union, a.GetSelectedKubeconfigs()) {
			return nil
		}
		return a.setSelectedKubeconfigs(mutation, union)
	})
}

// Release references without waiting for connection work when a peer or
// another panel still owns the selection. The final reference keeps the
// serialized teardown path so runtime retirement and reopening cannot overlap.
func (a *WorkspaceCoordinator) releaseOwnedPanelCluster(referenceID string) bool {
	a.workspaceSelectionsMu.Lock()
	defer a.workspaceSelectionsMu.Unlock()
	selection := a.panelSelections[referenceID]
	if selection == "" {
		return true
	}
	if clusterID, shared := strings.CutPrefix(referenceID, "panel-workspace:"); shared && a.PanelWorkspaceDirectory().HasClusterReference(clusterID) {
		return true
	}
	if !a.selectionHasOwnerLocked(selection, referenceID) {
		return false
	}
	delete(a.panelSelections, referenceID)
	return true
}
