package backend

import (
	"fmt"
	"sort"
	"strings"
)

type ClusterHealthState string

const (
	ClusterHealthUnknown  ClusterHealthState = "unknown"
	ClusterHealthHealthy  ClusterHealthState = "healthy"
	ClusterHealthDegraded ClusterHealthState = "degraded"
)

type ClusterWorkspaceAuthState struct {
	State             string `json:"state"`
	Reason            string `json:"reason"`
	ErrorClass        string `json:"errorClass"`
	SecondsUntilRetry int    `json:"secondsUntilRetry"`
	DiagnosticClass   string `json:"class"`
	DiagnosticKind    string `json:"kind"`
	DiagnosticSummary string `json:"summary"`
	ExecCommand       string `json:"execCommand"`
}

type ClusterWorkspaceClusterState struct {
	ClusterID     string                    `json:"clusterId"`
	ClusterName   string                    `json:"clusterName"`
	Lifecycle     ClusterLifecycleState     `json:"lifecycle"`
	Auth          ClusterWorkspaceAuthState `json:"auth"`
	Health        ClusterHealthState        `json:"health"`
	ScopeRevision uint64                    `json:"scopeRevision"`
}

type ClusterWorkspaceState struct {
	SelectedKubeconfigs []string                                `json:"selectedKubeconfigs"`
	VisibleClusterID    string                                  `json:"visibleClusterId"`
	Clusters            map[string]ClusterWorkspaceClusterState `json:"clusters"`
}

type ClusterWorkspaceCommand struct {
	WindowID                  string   `json:"windowId"`
	SelectedKubeconfigs       []string `json:"selectedKubeconfigs"`
	UpdateSelectedKubeconfigs bool     `json:"updateSelectedKubeconfigs"`
	VisibleClusterID          string   `json:"visibleClusterId"`
}

type ClusterWorkspaceResult struct {
	State ClusterWorkspaceState `json:"state"`
	Error string                `json:"error,omitempty"`
}

// markClusterWorkspaceChanged commits a mutation that can affect the aggregate
// workspace snapshot. Callers invoke it while still holding the lock that owns
// the changed source so a reader cannot observe the new value under the old
// revision.
func (p *ClusterWorkspaceProjection) markClusterWorkspaceChanged() {
	if p != nil {
		p.clusterWorkspaceRevision.Add(1)
	}
}

func (p *ClusterWorkspaceProjection) setClusterHealth(clusterID string, health ClusterHealthState) {
	if p == nil || strings.TrimSpace(clusterID) == "" {
		return
	}
	p.clusterWorkspaceMu.Lock()
	if p.clusterHealth == nil {
		p.clusterHealth = make(map[string]ClusterHealthState)
	}
	if p.clusterHealth[clusterID] != health {
		p.clusterHealth[clusterID] = health
		p.markClusterWorkspaceChanged()
	}
	p.clusterWorkspaceMu.Unlock()
}

func (p *ClusterWorkspaceProjection) incrementClusterScopeRevision(clusterID string) {
	if p == nil || strings.TrimSpace(clusterID) == "" {
		return
	}
	p.clusterWorkspaceMu.Lock()
	if p.clusterScopeRevisions == nil {
		p.clusterScopeRevisions = make(map[string]uint64)
	}
	p.clusterScopeRevisions[clusterID]++
	p.markClusterWorkspaceChanged()
	p.clusterWorkspaceMu.Unlock()
}

func (p *ClusterWorkspaceProjection) removeClusterWorkspaceRuntimeState(clusterID string) {
	if p == nil || clusterID == "" {
		return
	}
	p.clusterWorkspaceMu.Lock()
	_, hadHealth := p.clusterHealth[clusterID]
	_, hadScopeRevision := p.clusterScopeRevisions[clusterID]
	delete(p.clusterHealth, clusterID)
	delete(p.clusterScopeRevisions, clusterID)
	if hadHealth || hadScopeRevision {
		p.markClusterWorkspaceChanged()
	}
	p.clusterWorkspaceMu.Unlock()
}

func (a *WorkspaceCoordinator) removeClusterWorkspaceState(clusterID string) {
	if a == nil {
		return
	}
	a.removeClusterWorkspaceRuntimeState(clusterID)
	if a.clusterLifecycle != nil {
		a.clusterLifecycle.Remove(clusterID)
	}
}

func (p *ClusterWorkspaceProjection) clusterWorkspaceRuntimeState() (map[string]ClusterHealthState, map[string]uint64) {
	p.clusterWorkspaceMu.RLock()
	defer p.clusterWorkspaceMu.RUnlock()
	health := make(map[string]ClusterHealthState, len(p.clusterHealth))
	for clusterID, state := range p.clusterHealth {
		health[clusterID] = state
	}
	revisions := make(map[string]uint64, len(p.clusterScopeRevisions))
	for clusterID, revision := range p.clusterScopeRevisions {
		revisions[clusterID] = revision
	}
	return health, revisions
}

func (a *WorkspaceCoordinator) clusterWorkspaceAuthStates() map[string]ClusterWorkspaceClusterState {
	states := make(map[string]ClusterWorkspaceClusterState)
	if a == nil {
		return states
	}
	// Do not hold the client-map lock while reading an auth manager. Auth state
	// callbacks run with the manager lock held and look up their cluster client,
	// so holding these locks in the opposite order would deadlock.
	a.clusterClientsMu.Lock()
	clientsByCluster := make(map[string]*clusterClients, len(a.clusterClients))
	for clusterID, clients := range a.clusterClients {
		clientsByCluster[clusterID] = clients
	}
	a.clusterClientsMu.Unlock()
	for clusterID, clients := range clientsByCluster {
		state := ClusterWorkspaceClusterState{
			ClusterID: clusterID,
			Auth:      ClusterWorkspaceAuthState{State: "unknown"},
			Health:    ClusterHealthUnknown,
		}
		if clients != nil {
			state.ClusterName = clients.meta.Name
			if clients.authManager != nil {
				authState, _ := clients.authManager.State()
				diagnostic := clients.authManager.FailureDiagnostic()
				recovery := clients.authManager.RecoveryInfo()
				state.Auth = ClusterWorkspaceAuthState{
					State: authState.String(), Reason: diagnostic.Reason,
					ErrorClass: string(recovery.ErrorClass), SecondsUntilRetry: recovery.SecondsUntilRetry,
					DiagnosticClass: diagnostic.Class, DiagnosticKind: diagnostic.Kind,
					DiagnosticSummary: diagnostic.Summary, ExecCommand: diagnostic.ExecCommand,
				}
			}
		}
		states[clusterID] = state
	}
	return states
}

func readConsistentClusterWorkspaceState(
	revision func() uint64,
	build func() ClusterWorkspaceState,
) ClusterWorkspaceState {
	for {
		before := revision()
		state := build()
		if before == revision() {
			return state
		}
	}
}

// GetClusterWorkspaceState returns one revision-consistent snapshot of the
// cluster-indexed state used by selection, lifecycle, auth, health, and
// namespace-scope consumers.
func (a *WorkspaceCoordinator) GetClusterWorkspaceState() ClusterWorkspaceState {
	if a == nil {
		return ClusterWorkspaceState{Clusters: make(map[string]ClusterWorkspaceClusterState)}
	}
	a.selectionMutationMu.Lock()
	defer a.selectionMutationMu.Unlock()
	return a.captureClusterWorkspaceState("")
}

// GetClusterWorkspaceStateForWindow projects process-wide cluster state with
// the visible cluster belonging to the requesting peer window.
func (a *WorkspaceCoordinator) GetClusterWorkspaceStateForWindow(windowID string) ClusterWorkspaceState {
	if a == nil {
		return ClusterWorkspaceState{Clusters: make(map[string]ClusterWorkspaceClusterState)}
	}
	a.selectionMutationMu.Lock()
	defer a.selectionMutationMu.Unlock()
	windowID = strings.TrimSpace(windowID)
	a.ensureWorkspaceSelectionsLocked(windowID)
	return a.captureClusterWorkspaceState(windowID)
}

// captureClusterWorkspaceState requires the caller to hold the serialized
// selection-mutation boundary. Independent workspace sources remain protected
// by the revision retry below.
func (a *WorkspaceCoordinator) captureClusterWorkspaceState(windowID string) ClusterWorkspaceState {
	return readConsistentClusterWorkspaceState(a.clusterWorkspaceRevision.Load, func() ClusterWorkspaceState {
		return a.buildClusterWorkspaceState(windowID)
	})
}

func (a *WorkspaceCoordinator) buildClusterWorkspaceState(windowID string) ClusterWorkspaceState {
	state := ClusterWorkspaceState{
		SelectedKubeconfigs: a.selectedKubeconfigsForWorkspaceLocked(windowID),
		Clusters:            a.clusterWorkspaceAuthStates(),
	}
	a.governorMu.Lock()
	if windowID != "" {
		state.VisibleClusterID = a.governorWindows[windowID]
	} else {
		state.VisibleClusterID = a.governorVisible
	}
	a.governorMu.Unlock()

	if a.clusterLifecycle != nil {
		mergeClusterLifecycleStates(state.Clusters, a.clusterLifecycle.GetAllStates())
	}
	health, revisions := a.clusterWorkspaceRuntimeState()
	mergeClusterHealthStates(state.Clusters, health)
	mergeClusterScopeRevisions(state.Clusters, revisions)
	return state
}

func mergeClusterLifecycleStates(clusters map[string]ClusterWorkspaceClusterState, states map[string]ClusterLifecycleState) {
	for clusterID, lifecycle := range states {
		cluster := clusterWorkspaceStateWithDefaults(clusterID, clusters[clusterID])
		cluster.Lifecycle = lifecycle
		clusters[clusterID] = cluster
	}
}

func mergeClusterHealthStates(clusters map[string]ClusterWorkspaceClusterState, states map[string]ClusterHealthState) {
	for clusterID, healthState := range states {
		cluster := clusterWorkspaceStateWithDefaults(clusterID, clusters[clusterID])
		cluster.Health = healthState
		clusters[clusterID] = cluster
	}
}

func mergeClusterScopeRevisions(clusters map[string]ClusterWorkspaceClusterState, revisions map[string]uint64) {
	for clusterID, revision := range revisions {
		cluster := clusterWorkspaceStateWithDefaults(clusterID, clusters[clusterID])
		cluster.ScopeRevision = revision
		clusters[clusterID] = cluster
	}
}

func clusterWorkspaceStateWithDefaults(clusterID string, cluster ClusterWorkspaceClusterState) ClusterWorkspaceClusterState {
	cluster.ClusterID = clusterID
	if cluster.Auth.State == "" {
		cluster.Auth.State = "unknown"
	}
	if cluster.Health == "" {
		cluster.Health = ClusterHealthUnknown
	}
	return cluster
}

// ensureWorkspaceSelectionsLocked gives a newly observed peer the current
// process selection as its initial tab set. The caller must hold
// selectionMutationMu.
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
	a.markClusterWorkspaceChanged()
}

// selectedKubeconfigsForWorkspaceLocked projects the process union for legacy
// callers and one peer's owned tabs for window-aware callers. The caller must
// hold selectionMutationMu.
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
	a.markClusterWorkspaceChanged()
}

// retainWorkspaceSelectionsLocked removes selections that an external source
// (for example kubeconfig discovery) removed from the process selection. The
// caller must hold selectionMutationMu.
func (a *WorkspaceCoordinator) retainWorkspaceSelectionsLocked(remaining []string) {
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

// replaceWorkspaceSelectionsLocked projects a process-level selection restore
// into peers that registered before startup settings finished loading. The
// caller must hold selectionMutationMu.
func (a *WorkspaceCoordinator) replaceWorkspaceSelectionsLocked(selections []string) {
	for windowID := range a.workspaceSelections {
		a.setWorkspaceSelectionsLocked(windowID, selections)
	}
}

// aggregateWorkspaceSelectionsLocked returns a deterministic union while
// preserving the current process order for tabs that remain owned. The caller
// must hold selectionMutationMu.
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
	a.setWorkspaceSelectionsLocked(windowID, normalized)
	union := a.aggregateWorkspaceSelectionsLocked()
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
	a.releaseWorkspaceWindowForeground(windowID)
	if err := a.runOrderedSelectionMutation("release-workspace-window", func(mutation *selectionMutation) error {
		if _, tracked := a.workspaceSelections[windowID]; !tracked {
			return nil
		}
		delete(a.workspaceSelections, windowID)
		a.markClusterWorkspaceChanged()
		union := a.aggregateWorkspaceSelectionsLocked()
		if selectionSetsEqual(union, a.GetSelectedKubeconfigs()) {
			return nil
		}
		return a.setSelectedKubeconfigs(mutation, union)
	}); err != nil && a.appLogs.logger != nil {
		a.appLogs.logger.Warn(
			fmt.Sprintf("Failed to release cluster tabs for workspace window %s: %v", windowID, err),
			"KubeconfigManager",
		)
	}
}

// ApplyClusterWorkspace serializes selection mutation before foreground
// activation and returns the resulting authoritative workspace snapshot.
func (a *WorkspaceCoordinator) ApplyClusterWorkspace(command ClusterWorkspaceCommand) ClusterWorkspaceResult {
	windowID := strings.TrimSpace(command.WindowID)
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
			a.ensureWorkspaceSelectionsLocked(windowID)
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
		a.SetWindowVisibleCluster(windowID, clusterID)
		return
	}
	if clusterID == "" {
		return
	}
	if windowID != "" {
		a.SetWindowVisibleCluster(windowID, clusterID)
		return
	}
	a.SetVisibleCluster(clusterID)
}

func (a *WorkspaceCoordinator) latestClusterWorkspaceState(windowID string) ClusterWorkspaceState {
	if windowID != "" {
		return a.GetClusterWorkspaceStateForWindow(windowID)
	}
	return a.GetClusterWorkspaceState()
}

func clusterWorkspaceResult(state ClusterWorkspaceState, err error) ClusterWorkspaceResult {
	result := ClusterWorkspaceResult{State: state}
	if err != nil {
		result.Error = err.Error()
	}
	return result
}
