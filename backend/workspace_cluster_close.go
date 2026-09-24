package backend

import (
	"fmt"
	"slices"
)

// CloseClusterView acknowledges committed membership before runtime cleanup.
// The registry has already checked panel guards. Cleanup retains the selection
// mutation lease so reopen and shutdown cannot race the retiring runtime.
func (a *WorkspaceCoordinator) CloseClusterView(windowID, clusterID string) error {
	current := a.GetClusterWorkspaceStateForWindow(windowID).SelectedKubeconfigs
	remaining := slices.DeleteFunc(slices.Clone(current), func(selection string) bool {
		return a.clusterIDForSelection(selection) == clusterID
	})
	if len(remaining) != len(current) {
		a.cancelObsoleteWorkspaceConnection(windowID, remaining)
	}
	accepted := make(chan error, 1)
	go func() {
		committed := false
		err := a.runOrderedSelectionMutation("close-cluster-view", func(mutation *selectionMutation) error {
			intent, err := a.commitClusterViewClose(mutation, windowID, clusterID)
			if err != nil {
				return err
			}
			committed = true
			accepted <- nil
			if intent == nil {
				return nil
			}
			return a.finishKubeconfigSelection(mutation, *intent)
		})
		if !committed {
			accepted <- err
		} else if err != nil {
			a.logger.Warn(fmt.Sprintf("Cluster close cleanup failed for %s: %v", clusterID, err), "KubeconfigManager", clusterID)
		}
	}()
	return <-accepted
}

func (a *WorkspaceCoordinator) commitClusterViewClose(mutation *selectionMutation, windowID, clusterID string) (*selectionChangeIntent, error) {
	intent, err := a.removeClusterView(mutation, windowID, clusterID)
	if err != nil || intent == nil {
		return intent, err
	}
	a.commitKubeconfigSelection(mutation, intent)
	return intent, nil
}

func (a *WorkspaceCoordinator) removeClusterView(mutation *selectionMutation, windowID, clusterID string) (*selectionChangeIntent, error) {
	selection := a.selectionForOpenCluster(clusterID)
	a.workspaceSelectionsMu.Lock()
	defer a.workspaceSelectionsMu.Unlock()
	current := a.workspaceSelections[windowID]
	if selection == "" || !slices.Contains(current, selection) {
		return nil, fmt.Errorf("cluster close source no longer displays the cluster")
	}
	remaining := slices.DeleteFunc(slices.Clone(current), func(value string) bool { return value == selection })
	a.setWorkspaceSelectionsLocked(windowID, remaining)
	union := a.aggregateWorkspaceSelectionsLocked()
	var intent *selectionChangeIntent
	if !selectionSetsEqual(union, a.GetSelectedKubeconfigs()) {
		prepared, err := a.prepareKubeconfigSelection(mutation, union)
		if err != nil {
			// No reader can observe a rejected removal while this lock is held.
			a.setWorkspaceSelectionsLocked(windowID, current)
			return nil, err
		}
		intent = &prepared
	}
	a.PanelWorkspaceDirectory().RetainWindowCluster(windowID, clusterID)
	return intent, nil
}
