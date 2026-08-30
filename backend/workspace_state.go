package backend

import (
	"fmt"
	"sort"
	"strings"
)

func (a *WorkspaceCoordinator) removeClusterWorkspaceState(clusterID string) {
	if a == nil {
		return
	}
	a.clusterWorkspace.removeClusterWorkspaceRuntimeState(clusterID)
	a.clusterRuntime.removeClusterLifecycleState(clusterID)
}

// GetClusterWorkspaceState returns one revision-consistent snapshot of the
// cluster-indexed state used by selection, lifecycle, auth, health, and
// namespace-scope consumers.
func (a *WorkspaceCoordinator) GetClusterWorkspaceState() ClusterWorkspaceState {
	if a == nil {
		return ClusterWorkspaceState{Clusters: make(map[string]ClusterWorkspaceClusterState)}
	}
	return a.captureClusterWorkspaceState("")
}

// GetClusterWorkspaceStateForWindow projects process-wide cluster state with
// the visible cluster belonging to the requesting peer window.
func (a *WorkspaceCoordinator) GetClusterWorkspaceStateForWindow(windowID string) ClusterWorkspaceState {
	if a == nil {
		return ClusterWorkspaceState{Clusters: make(map[string]ClusterWorkspaceClusterState)}
	}
	windowID = strings.TrimSpace(windowID)
	a.ensureWorkspaceSelections(windowID)
	return a.captureClusterWorkspaceState(windowID)
}

// captureClusterWorkspaceState reads peer selection state independently from
// slow cluster connection work. Independent workspace sources remain protected
// by the revision retry below.
func (a *WorkspaceCoordinator) captureClusterWorkspaceState(windowID string) ClusterWorkspaceState {
	a.workspaceSelectionsMu.RLock()
	defer a.workspaceSelectionsMu.RUnlock()
	return readConsistentClusterWorkspaceState(a.clusterWorkspace.revision, func() ClusterWorkspaceState {
		return a.buildClusterWorkspaceState(windowID)
	})
}

func (a *WorkspaceCoordinator) buildClusterWorkspaceState(windowID string) ClusterWorkspaceState {
	state := ClusterWorkspaceState{
		SelectedKubeconfigs: a.selectedKubeconfigsForWorkspaceLocked(windowID),
		Clusters:            a.clusterRuntime.clusterWorkspaceAuthStates(),
	}
	state.VisibleClusterID = a.refresh.visibleClusterForWindow(windowID)

	mergeClusterLifecycleStates(state.Clusters, a.clusterRuntime.clusterLifecycleStates())
	health, revisions := a.clusterWorkspace.clusterWorkspaceRuntimeState()
	mergeClusterHealthStates(state.Clusters, health)
	mergeClusterScopeRevisions(state.Clusters, revisions)
	return state
}

func (a *WorkspaceCoordinator) ensureWorkspaceSelections(windowID string) {
	a.workspaceSelectionsMu.Lock()
	defer a.workspaceSelectionsMu.Unlock()
	a.ensureWorkspaceSelectionsLocked(windowID)
}

// ensureWorkspaceSelectionsLocked gives a newly observed peer the current
// process selection as its initial tab set. The caller must hold
// workspaceSelectionsMu.
func (a *WorkspaceCoordinator) ensureWorkspaceSelectionsLocked(windowID string) {
	if a == nil || windowID == "" {
		return
	}
	if a.workspaceSelections == nil {
		a.workspaceSelections = make(map[string][]string)
	}
	if _, exists := a.workspaceSelections[windowID]; exists {
		return
	}
	a.workspaceSelections[windowID] = a.GetSelectedKubeconfigs()
	a.clusterWorkspace.markClusterWorkspaceChanged()
}

// selectedKubeconfigsForWorkspaceLocked projects the process union for legacy
// callers and one peer's owned tabs for window-aware callers. The caller must
// hold workspaceSelectionsMu for reading.
func (a *WorkspaceCoordinator) selectedKubeconfigsForWorkspaceLocked(windowID string) []string {
	if windowID == "" {
		return a.GetSelectedKubeconfigs()
	}
	return append([]string(nil), a.workspaceSelections[windowID]...)
}

func (a *WorkspaceCoordinator) setWorkspaceSelectionsLocked(windowID string, selections []string) {
	if a.workspaceSelections == nil {
		a.workspaceSelections = make(map[string][]string)
	}
	previous, exists := a.workspaceSelections[windowID]
	if exists && selectionSetsEqual(previous, selections) {
		return
	}
	a.workspaceSelections[windowID] = append([]string(nil), selections...)
	a.clusterWorkspace.markClusterWorkspaceChanged()
}

// retainWorkspaceSelections removes selections that an external source (for
// example kubeconfig discovery) removed from the process selection.
func (a *WorkspaceCoordinator) retainWorkspaceSelections(remaining []string) {
	a.workspaceSelectionsMu.Lock()
	defer a.workspaceSelectionsMu.Unlock()
	allowed := make(map[string]struct{}, len(remaining))
	for _, selection := range remaining {
		allowed[selection] = struct{}{}
	}
	for windowID, selections := range a.workspaceSelections {
		kept := make([]string, 0, len(selections))
		for _, selection := range selections {
			if _, exists := allowed[selection]; exists {
				kept = append(kept, selection)
			}
		}
		a.setWorkspaceSelectionsLocked(windowID, kept)
	}
}

// replaceWorkspaceSelections projects a process-level selection restore into
// peers that registered before startup settings finished loading.
func (a *WorkspaceCoordinator) replaceWorkspaceSelections(selections []string) {
	a.workspaceSelectionsMu.Lock()
	defer a.workspaceSelectionsMu.Unlock()
	for windowID := range a.workspaceSelections {
		a.setWorkspaceSelectionsLocked(windowID, selections)
	}
}

// aggregateWorkspaceSelectionsLocked returns a deterministic union while
// preserving the current process order for tabs that remain owned. The caller
// must hold workspaceSelectionsMu.
func (a *WorkspaceCoordinator) aggregateWorkspaceSelectionsLocked() []string {
	wanted := make(map[string]struct{})
	for _, selections := range a.workspaceSelections {
		for _, selection := range selections {
			wanted[selection] = struct{}{}
		}
	}

	union := make([]string, 0, len(wanted))
	seen := make(map[string]struct{}, len(wanted))
	appendSelection := func(selection string) {
		if _, keep := wanted[selection]; !keep {
			return
		}
		if _, exists := seen[selection]; exists {
			return
		}
		seen[selection] = struct{}{}
		union = append(union, selection)
	}
	for _, selection := range a.GetSelectedKubeconfigs() {
		appendSelection(selection)
	}

	windowIDs := make([]string, 0, len(a.workspaceSelections))
	for windowID := range a.workspaceSelections {
		windowIDs = append(windowIDs, windowID)
	}
	sort.Strings(windowIDs)
	for _, windowID := range windowIDs {
		for _, selection := range a.workspaceSelections[windowID] {
			appendSelection(selection)
		}
	}
	return union
}

func (a *WorkspaceCoordinator) applyWorkspaceSelections(
	mutation *selectionMutation,
	windowID string,
	selections []string,
) error {
	var normalized []string
	if len(selections) > 0 {
		_, normalizedSelections, err := a.normalizeSelectionSet(selections)
		if err != nil {
			return err
		}
		normalized = normalizedSelections
	}
	a.workspaceSelectionsMu.Lock()
	a.setWorkspaceSelectionsLocked(windowID, normalized)
	union := a.aggregateWorkspaceSelectionsLocked()
	a.workspaceSelectionsMu.Unlock()
	if selectionSetsEqual(union, a.GetSelectedKubeconfigs()) {
		return nil
	}
	return a.setSelectedKubeconfigs(mutation, union)
}

// ReleaseWorkspaceWindow relinquishes both foreground demand and every cluster
// tab owned by a closed peer. Shared cluster runtime state survives while any
// other peer still owns the same selection.
func (a *WorkspaceCoordinator) ReleaseWorkspaceWindow(windowID string) {
	windowID = strings.TrimSpace(windowID)
	if a == nil || windowID == "" {
		return
	}
	a.refresh.releaseWorkspaceWindowForeground(windowID)
	if err := a.runOrderedSelectionMutation("release-workspace-window", func(mutation *selectionMutation) error {
		a.workspaceSelectionsMu.Lock()
		if _, tracked := a.workspaceSelections[windowID]; !tracked {
			a.workspaceSelectionsMu.Unlock()
			return nil
		}
		delete(a.workspaceSelections, windowID)
		a.clusterWorkspace.markClusterWorkspaceChanged()
		union := a.aggregateWorkspaceSelectionsLocked()
		a.workspaceSelectionsMu.Unlock()
		if selectionSetsEqual(union, a.GetSelectedKubeconfigs()) {
			return nil
		}
		return a.setSelectedKubeconfigs(mutation, union)
	}); err != nil && a.logger != nil {
		a.logger.Warn(
			fmt.Sprintf("Failed to release cluster tabs for workspace window %s: %v", windowID, err),
			"KubeconfigManager",
		)
	}
}

// ApplyClusterWorkspace serializes commands that mutate cluster selections and
// applies visibility-only commands independently. Foreground intent must remain
// writable while a selected cluster is still connecting.
func (a *WorkspaceCoordinator) ApplyClusterWorkspace(command ClusterWorkspaceCommand) ClusterWorkspaceResult {
	windowID := strings.TrimSpace(command.WindowID)
	if !command.UpdateSelectedKubeconfigs {
		if windowID != "" {
			a.ensureWorkspaceSelections(windowID)
		}
		a.updateClusterWorkspaceVisibility(windowID, command)
		return clusterWorkspaceResult(a.latestClusterWorkspaceState(windowID), nil)
	}
	var state ClusterWorkspaceState
	captured := false
	err := a.runClusterWorkspaceMutation(windowID, func(mutation *selectionMutation) error {
		if err := a.applyClusterWorkspaceMutation(mutation, windowID, command); err != nil {
			return err
		}
		state = a.captureClusterWorkspaceState(windowID)
		captured = true
		return nil
	})
	// A superseded mutation skips the callback. Return the latest coherent state
	// in that case; an applied mutation captures before releasing its serialized
	// selection boundary.
	if !captured {
		state = a.latestClusterWorkspaceState(windowID)
	}
	return clusterWorkspaceResult(state, err)
}

func (a *WorkspaceCoordinator) runClusterWorkspaceMutation(
	windowID string,
	apply func(*selectionMutation) error,
) error {
	if windowID != "" {
		return a.runOrderedSelectionMutation("apply-cluster-workspace", apply)
	}
	return a.runSelectionMutation("apply-cluster-workspace", apply)
}

func (a *WorkspaceCoordinator) applyClusterWorkspaceMutation(
	mutation *selectionMutation,
	windowID string,
	command ClusterWorkspaceCommand,
) error {
	if err := a.updateClusterWorkspaceSelections(mutation, windowID, command); err != nil {
		return err
	}
	if err := mutation.context().Err(); err != nil {
		return err
	}
	a.updateClusterWorkspaceVisibility(windowID, command)
	return nil
}

func (a *WorkspaceCoordinator) updateClusterWorkspaceSelections(
	mutation *selectionMutation,
	windowID string,
	command ClusterWorkspaceCommand,
) error {
	if !command.UpdateSelectedKubeconfigs {
		if windowID != "" {
			a.ensureWorkspaceSelections(windowID)
		}
		return nil
	}
	if windowID != "" {
		return a.applyWorkspaceSelections(mutation, windowID, command.SelectedKubeconfigs)
	}
	return a.setSelectedKubeconfigs(mutation, command.SelectedKubeconfigs)
}

func (a *WorkspaceCoordinator) updateClusterWorkspaceVisibility(windowID string, command ClusterWorkspaceCommand) {
	clusterID := strings.TrimSpace(command.VisibleClusterID)
	if windowID != "" && command.UpdateSelectedKubeconfigs {
		a.refresh.SetWindowVisibleCluster(windowID, clusterID)
		return
	}
	if clusterID == "" {
		return
	}
	if windowID != "" {
		a.refresh.SetWindowVisibleCluster(windowID, clusterID)
		return
	}
	a.refresh.SetVisibleCluster(clusterID)
}

func (a *WorkspaceCoordinator) latestClusterWorkspaceState(windowID string) ClusterWorkspaceState {
	if windowID != "" {
		return a.GetClusterWorkspaceStateForWindow(windowID)
	}
	return a.GetClusterWorkspaceState()
}
