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
