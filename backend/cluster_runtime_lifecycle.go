package backend

func (m *ClusterRuntimeManager) initializeClusterLifecycle() {
	lifecycle := newClusterLifecycle(func(clusterID string, state, previousState ClusterLifecycleState) {
		// An empty previousState means "no previous state" (first transition).
		m.emitEvent(clusterLifecycleEventName, ClusterLifecycleEvent{
			ClusterID:     clusterID,
			State:         state,
			PreviousState: string(previousState),
		})
	})
	lifecycle.setSnapshotChangeObserver(m.projection.markClusterWorkspaceChanged)
	m.clusterLifecycle = lifecycle
}

// anyClusterAuthInvalid returns true if any cluster has an auth state that is not Valid.
// Used to suppress auth error logging when we know auth issues exist.
func (a *ClusterRuntimeManager) anyClusterAuthInvalid() bool {
	for _, clients := range a.snapshotClusterClients() {
		if clients == nil || clients.authManager == nil {
			continue
		}
		if !clients.authManager.IsValid() {
			return true
		}
	}
	return false
}
