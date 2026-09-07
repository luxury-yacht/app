package backend

import (
	"fmt"
	"slices"
)

// CloseClusterView records an explicit tab close before the native registry
// considers another view's close. The registry has already checked its guards.
func (a *WorkspaceCoordinator) CloseClusterView(windowID, clusterID string) error {
	return a.runOrderedSelectionMutation("close-cluster-view", func(mutation *selectionMutation) error {
		selection := a.selectionForOpenCluster(clusterID)
		a.workspaceSelectionsMu.Lock()
		current := a.workspaceSelections[windowID]
		if selection == "" || !slices.Contains(current, selection) {
			a.workspaceSelectionsMu.Unlock()
			return fmt.Errorf("cluster close source no longer displays the cluster")
		}
		remaining := slices.DeleteFunc(slices.Clone(current), func(value string) bool { return value == selection })
		a.retainRemovedClusterViewsLocked(windowID, remaining)
		a.setWorkspaceSelectionsLocked(windowID, remaining)
		union := a.aggregateWorkspaceSelectionsLocked()
		a.workspaceSelectionsMu.Unlock()
		if selectionSetsEqual(union, a.GetSelectedKubeconfigs()) {
			return nil
		}
		return a.setSelectedKubeconfigs(mutation, union)
	})
}
