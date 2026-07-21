package backend

import "strings"

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
	SelectedKubeconfigs       []string `json:"selectedKubeconfigs"`
	UpdateSelectedKubeconfigs bool     `json:"updateSelectedKubeconfigs"`
	VisibleClusterID          string   `json:"visibleClusterId"`
}

type ClusterWorkspaceResult struct {
	State ClusterWorkspaceState `json:"state"`
	Error string                `json:"error,omitempty"`
}

func (a *App) setClusterHealth(clusterID string, health ClusterHealthState) {
	if a == nil || strings.TrimSpace(clusterID) == "" {
		return
	}
	a.clusterWorkspaceMu.Lock()
	if a.clusterHealth == nil {
		a.clusterHealth = make(map[string]ClusterHealthState)
	}
	a.clusterHealth[clusterID] = health
	a.clusterWorkspaceMu.Unlock()
}

func (a *App) incrementClusterScopeRevision(clusterID string) {
	if a == nil || strings.TrimSpace(clusterID) == "" {
		return
	}
	a.clusterWorkspaceMu.Lock()
	if a.clusterScopeRevisions == nil {
		a.clusterScopeRevisions = make(map[string]uint64)
	}
	a.clusterScopeRevisions[clusterID]++
	a.clusterWorkspaceMu.Unlock()
}

func (a *App) removeClusterWorkspaceRuntimeState(clusterID string) {
	if a == nil || clusterID == "" {
		return
	}
	a.clusterWorkspaceMu.Lock()
	delete(a.clusterHealth, clusterID)
	delete(a.clusterScopeRevisions, clusterID)
	a.clusterWorkspaceMu.Unlock()
}

func (a *App) clusterWorkspaceRuntimeState() (map[string]ClusterHealthState, map[string]uint64) {
	a.clusterWorkspaceMu.RLock()
	defer a.clusterWorkspaceMu.RUnlock()
	health := make(map[string]ClusterHealthState, len(a.clusterHealth))
	for clusterID, state := range a.clusterHealth {
		health[clusterID] = state
	}
	revisions := make(map[string]uint64, len(a.clusterScopeRevisions))
	for clusterID, revision := range a.clusterScopeRevisions {
		revisions[clusterID] = revision
	}
	return health, revisions
}

func (a *App) clusterWorkspaceAuthStates() map[string]ClusterWorkspaceClusterState {
	states := make(map[string]ClusterWorkspaceClusterState)
	if a == nil {
		return states
	}
	a.clusterClientsMu.Lock()
	defer a.clusterClientsMu.Unlock()
	for clusterID, clients := range a.clusterClients {
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

// GetClusterWorkspaceState returns one snapshot of the cluster-indexed state
// used by selection, lifecycle, auth, health, and namespace-scope consumers.
func (a *App) GetClusterWorkspaceState() ClusterWorkspaceState {
	if a == nil {
		return ClusterWorkspaceState{Clusters: make(map[string]ClusterWorkspaceClusterState)}
	}
	state := ClusterWorkspaceState{
		SelectedKubeconfigs: a.GetSelectedKubeconfigs(),
		Clusters:            a.clusterWorkspaceAuthStates(),
	}
	a.governorMu.Lock()
	state.VisibleClusterID = a.governorVisible
	a.governorMu.Unlock()

	if a.clusterLifecycle != nil {
		for clusterID, lifecycle := range a.clusterLifecycle.GetAllStates() {
			cluster := state.Clusters[clusterID]
			cluster.ClusterID = clusterID
			cluster.Lifecycle = lifecycle
			if cluster.Auth.State == "" {
				cluster.Auth.State = "unknown"
			}
			if cluster.Health == "" {
				cluster.Health = ClusterHealthUnknown
			}
			state.Clusters[clusterID] = cluster
		}
	}
	health, revisions := a.clusterWorkspaceRuntimeState()
	for clusterID, healthState := range health {
		cluster := state.Clusters[clusterID]
		cluster.ClusterID = clusterID
		cluster.Health = healthState
		if cluster.Auth.State == "" {
			cluster.Auth.State = "unknown"
		}
		state.Clusters[clusterID] = cluster
	}
	for clusterID, revision := range revisions {
		cluster := state.Clusters[clusterID]
		cluster.ClusterID = clusterID
		cluster.ScopeRevision = revision
		if cluster.Auth.State == "" {
			cluster.Auth.State = "unknown"
		}
		if cluster.Health == "" {
			cluster.Health = ClusterHealthUnknown
		}
		state.Clusters[clusterID] = cluster
	}
	return state
}

// ApplyClusterWorkspace serializes selection mutation before foreground
// activation and returns the resulting authoritative workspace snapshot.
func (a *App) ApplyClusterWorkspace(command ClusterWorkspaceCommand) ClusterWorkspaceResult {
	if command.UpdateSelectedKubeconfigs {
		if err := a.SetSelectedKubeconfigs(command.SelectedKubeconfigs); err != nil {
			return ClusterWorkspaceResult{State: a.GetClusterWorkspaceState(), Error: err.Error()}
		}
	}
	if clusterID := strings.TrimSpace(command.VisibleClusterID); clusterID != "" {
		a.SetVisibleCluster(clusterID)
	}
	return ClusterWorkspaceResult{State: a.GetClusterWorkspaceState()}
}
