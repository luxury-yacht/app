package backend

import (
	"context"
	"fmt"
)

// syncClusterClientPool builds missing clients for the provided selections and drops stale entries.
func (a *WorkspaceCoordinator) syncClusterClientPool(selections []kubeconfigSelection) error {
	return a.syncClusterClientPoolWithContext(context.Background(), selections)
}

// syncClusterClientPoolWithContext builds missing clients for the provided selections and drops stale entries.
func (a *WorkspaceCoordinator) syncClusterClientPoolWithContext(ctx context.Context, selections []kubeconfigSelection) error {
	if a == nil {
		return fmt.Errorf("workspace coordinator is nil")
	}
	return a.syncClusterClientPoolWithBuilder(ctx, selections, a.clusterRuntime.buildClusterClientsWithContext)
}

func (a *WorkspaceCoordinator) syncClusterClientPoolWithBuilder(
	ctx context.Context,
	selections []kubeconfigSelection,
	build clusterClientBuilder,
) error {
	ctx, err := validateClusterClientSync(a.clusterRuntime, ctx, build)
	if err != nil {
		return err
	}
	desired := a.clusterRuntime.desiredClusterClientSelections(selections)
	tasks := a.clusterRuntime.clusterClientCreateTasks(desired)
	if err := a.clusterRuntime.createClusterClients(ctx, tasks, build); err != nil {
		return err
	}
	a.cleanupRemovedClusterClients(a.clusterRuntime.removeUndesiredClusterClients(desired))
	return nil
}

func (a *WorkspaceCoordinator) cleanupRemovedClusterClients(removed []removedClusterClient) {
	for _, item := range removed {
		if item.authManager != nil {
			item.authManager.Shutdown()
		}
	}
	for _, item := range removed {
		if a.operations != nil {
			a.operations.StopCluster(item.clusterID)
		}
	}
	for _, item := range removed {
		a.clusterRuntime.ensureKubernetesAPIMetricsRegistry().remove(item.clusterID)
		a.removeClusterWorkspaceState(item.clusterID)
	}
}
