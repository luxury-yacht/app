package backend

func (a *ClusterRuntimeManager) clusterWorkspaceAuthStates() map[string]ClusterWorkspaceClusterState {
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
