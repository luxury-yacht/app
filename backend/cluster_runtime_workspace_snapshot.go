package backend

func (a *ClusterRuntimeManager) clusterWorkspaceAuthStates() map[string]ClusterWorkspaceClusterState {
	states := make(map[string]ClusterWorkspaceClusterState)
	for clusterID, clients := range a.snapshotClusterClients() {
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
