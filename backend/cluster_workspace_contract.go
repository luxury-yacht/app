package backend

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

func clusterWorkspaceResult(state ClusterWorkspaceState, err error) ClusterWorkspaceResult {
	result := ClusterWorkspaceResult{State: state}
	if err != nil {
		result.Error = err.Error()
	}
	return result
}
