package backend

import (
	"fmt"
	"github.com/luxury-yacht/app/internal/panelwindow"
	"slices"
)

// StageClusterViewTransfer adds the destination before the source can leave.
// The process selection is unchanged throughout this same-cluster handoff.
func (a *WorkspaceCoordinator) StageClusterViewTransfer(source, target, clusterID string) (bool, error) {
	if source == "" || target == "" || source == target {
		return false, fmt.Errorf("cluster view transfer requires distinct app windows")
	}
	alreadyOpen := false
	err := a.runOrderedSelectionMutation("stage-cluster-view-transfer", func(_ *selectionMutation) error {
		selection := a.selectionForOpenCluster(clusterID)
		a.workspaceSelectionsMu.Lock()
		defer a.workspaceSelectionsMu.Unlock()
		if selection == "" || (!slices.Contains(a.workspaceSelections[source], selection) && a.panelSelections[source] != selection) {
			return fmt.Errorf("source app no longer displays the cluster")
		}
		existing := a.workspaceSelections[target]
		alreadyOpen = slices.Contains(existing, selection)
		if !alreadyOpen {
			a.setWorkspaceSelectionsLocked(target, append(slices.Clone(existing), selection))
		}
		return nil
	})
	return alreadyOpen, err
}

func (a *WorkspaceCoordinator) CommitClusterViewTransfer(source, target, clusterID string, groups []panelwindow.WorkspaceGroup) error {
	return a.runOrderedSelectionMutation("commit-cluster-view-transfer", func(_ *selectionMutation) error {
		selection := a.selectionForOpenCluster(clusterID)
		a.workspaceSelectionsMu.Lock()
		defer a.workspaceSelectionsMu.Unlock()
		if selection == "" || !slices.Contains(a.workspaceSelections[source], selection) || !slices.Contains(a.workspaceSelections[target], selection) {
			return fmt.Errorf("cluster view transfer participant no longer displays the cluster")
		}
		if err := a.PanelWorkspaceDirectory().TransferClusterView(source, target, clusterID, groups); err != nil {
			return err
		}
		remaining := slices.DeleteFunc(slices.Clone(a.workspaceSelections[source]), func(value string) bool { return value == selection })
		a.setWorkspaceSelectionsLocked(source, remaining)
		return nil
	})
}

// CancelClusterViewTransfer is used only for a destination tab introduced by
// the corresponding pending transfer. Existing destination views are retained.
func (a *WorkspaceCoordinator) CancelClusterViewTransfer(target, clusterID string) error {
	return a.runOrderedSelectionMutation("cancel-cluster-view-transfer", func(mutation *selectionMutation) error {
		selection := a.selectionForOpenCluster(clusterID)
		a.workspaceSelectionsMu.RLock()
		remaining := slices.DeleteFunc(slices.Clone(a.workspaceSelections[target]), func(value string) bool { return value == selection })
		a.workspaceSelectionsMu.RUnlock()
		return a.applyWorkspaceSelections(mutation, target, remaining)
	})
}
