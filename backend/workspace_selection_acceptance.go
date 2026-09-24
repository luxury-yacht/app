package backend

import "fmt"

// A tab is admitted before its connection work. The renderer can then issue a
// close while preflight is still running; runtime publication and teardown keep
// the existing serialized mutation lease and shutdown drain.
func (a *WorkspaceCoordinator) acceptWorkspaceSelection(windowID string, command ClusterWorkspaceCommand) ClusterWorkspaceResult {
	a.cancelObsoleteWorkspaceConnection(windowID, command.SelectedKubeconfigs)
	accepted := make(chan ClusterWorkspaceResult, 1)
	go func() {
		committed := false
		err := a.runOrderedSelectionMutation("apply-cluster-workspace", func(mutation *selectionMutation) error {
			intent, err := a.commitWorkspaceSelections(mutation, windowID, command.SelectedKubeconfigs)
			if err != nil {
				return err
			}
			a.updateClusterWorkspaceVisibility(windowID, command)
			committed = true
			accepted <- clusterWorkspaceResult(a.captureClusterWorkspaceState(windowID), nil)
			if intent == nil {
				return nil
			}
			return a.finishAcceptedSelection(mutation, *intent)
		})
		if !committed {
			accepted <- clusterWorkspaceResult(a.latestClusterWorkspaceState(windowID), err)
		} else if err != nil {
			a.logger.Warn(fmt.Sprintf("Cluster selection connection failed: %v", err), "KubeconfigManager")
		}
	}()
	return <-accepted
}

func (a *WorkspaceCoordinator) finishAcceptedSelection(mutation *selectionMutation, intent selectionChangeIntent) error {
	err := a.finishKubeconfigSelection(mutation, intent)
	if err == nil || mutation.context().Err() != nil {
		return err
	}
	for _, selection := range intent.normalizedSelections {
		clusterID := a.clusterIDForParsedSelection(selection)
		switch a.clusterRuntime.clusterLifecycleState(clusterID) {
		case "", ClusterStateConnecting, ClusterStateConnected, ClusterStateReconnecting:
			a.clusterRuntime.setClusterLifecycleState(clusterID, ClusterStateDisconnected)
		}
	}
	return err
}

// Ownership-only edits must preserve another view's in-flight authentication.
// Only a different process-wide selection can preempt connection work.
func (a *WorkspaceCoordinator) cancelObsoleteWorkspaceConnection(windowID string, selections []string) {
	_, normalized, err := a.normalizeSelectionSet(selections)
	if err != nil {
		return
	}
	a.workspaceSelectionsMu.RLock()
	wanted := make(map[string]struct{})
	for peer, owned := range a.workspaceSelections {
		if peer != windowID {
			for _, selection := range owned {
				wanted[selection] = struct{}{}
			}
		}
	}
	for _, selection := range a.panelSelections {
		wanted[selection] = struct{}{}
	}
	for _, selection := range normalized {
		wanted[selection] = struct{}{}
	}
	current := a.GetSelectedKubeconfigs()
	a.workspaceSelectionsMu.RUnlock()
	if !workspaceSelectionMatches(wanted, current) {
		a.cancelActiveSelectionGeneration()
	}
}

func workspaceSelectionMatches(wanted map[string]struct{}, current []string) bool {
	if len(wanted) != len(current) {
		return false
	}
	for _, selection := range current {
		if _, exists := wanted[selection]; !exists {
			return false
		}
	}
	return true
}
