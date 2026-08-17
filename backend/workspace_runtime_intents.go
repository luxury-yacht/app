package backend

func (a *WorkspaceCoordinator) consumeClusterRuntimeIntent(intent ClusterRuntimeIntent) {
	if !a.acceptClusterRuntimeIntent(intent) {
		return
	}
	switch intent.Kind {
	case ClusterRuntimeIntentKubeconfigSourceChanged:
		a.handleKubeconfigChange(intent.Paths)
	case ClusterRuntimeIntentAuthRebuild:
		if command, ok := newClusterAuthStateCommand(intent.ClusterID, a.clusterRuntime.clusterAuthDisplayName(intent.ClusterID), intent.AuthState, intent.Diagnostic); ok {
			a.dispatchClusterAuthMutation(intent, command)
		}
	case ClusterRuntimeIntentTransportRebuild:
		a.runClusterTransportRebuild(intent.ClusterID, intent.Cause, nil)
	}
}
