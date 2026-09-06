package backend

import (
	"fmt"

	"github.com/luxury-yacht/app/backend/internal/logsources"
)

// teardownClusterSubsystem stops the refresh subsystem for a specific cluster
// without affecting other clusters.
func (a *RefreshCoordinator) teardownClusterSubsystem(clusterID string) {
	if a == nil || clusterID == "" {
		return
	}

	// Get and remove the subsystem for this cluster.
	subsystem := a.takeRefreshSubsystem(clusterID)
	if subsystem == nil {
		// No routed subsystem; still stop any orphaned generation through the
		// same reverse-order contract.
		a.stopRefreshGenerationRuntimesForCluster(clusterID)
		return
	}

	a.logger.Info(fmt.Sprintf("Tearing down subsystem for cluster %s", clusterID), logsources.Auth, clusterID, clusterID)

	if aggregates := a.refreshAggregates.Load(); aggregates != nil {
		subsystems, order := refreshSubsystemTopology(a.snapshotRefreshSubsystems())
		_ = aggregates.Update(order, subsystems)
	}

	// Stop all feeds through the shared reverse-order generation contract.
	a.stopRefreshGenerationProducers(clusterID, subsystem)
	subsystem.RetireSnapshotServing()

	// Spill this cluster's stores to disk now that the subsystem is quiescent, so a re-warm
	// re-paints them fast before its informers re-sync (the heap they hold is reclaimed by the
	// governor's Cold action right after this returns). The maintained query stores give the
	// instant warm-paint; the ingest stores (+ their RV) let each reflector resume from a
	// delta instead of a full re-LIST.
	a.spillClusterStores(clusterID, subsystem.Registry)
	a.spillClusterIngestStores(clusterID, subsystem.IngestManager)
	a.closeCooledClosers(clusterID, subsystem)
}

// rebuildClusterSubsystem rebuilds the cluster clients and refresh subsystem
// for a specific cluster after auth recovery. This rebuilds everything with
// fresh credentials from the kubeconfig to pick up refreshed SSO tokens.
func (a *RefreshCoordinator) rebuildClusterSubsystem(clusterID string) {
	if a == nil || clusterID == "" {
		return
	}
	a.logger.Info(fmt.Sprintf("Rebuilding subsystem for cluster %s", clusterID), logsources.Auth, clusterID, clusterID)
	rebuild, ok := a.prepareClusterSubsystemRebuild(clusterID)
	if !ok {
		return
	}
	rebuild.run()
}

func (a *RefreshCoordinator) prepareClusterSubsystemRebuild(clusterID string) (clusterSubsystemRebuild, bool) {
	oldClients := a.clusterRuntime.clusterClientsForID(clusterID)
	if oldClients == nil {
		a.logger.Warn(fmt.Sprintf("Cannot rebuild subsystem for cluster %s: clients not found", clusterID), logsources.Auth, clusterID, clusterID)
		return clusterSubsystemRebuild{}, false
	}
	selection := kubeconfigSelection{Path: oldClients.kubeconfigPath, Context: oldClients.kubeconfigContext}
	if selection.Path == "" {
		a.logger.Warn(fmt.Sprintf("Cannot rebuild subsystem for cluster %s: selection not found", clusterID), logsources.Auth, clusterID, oldClients.meta.Name)
		return clusterSubsystemRebuild{}, false
	}
	return clusterSubsystemRebuild{
		refresh: a, clusterID: clusterID, clusterName: oldClients.meta.Name,
		selection: selection, oldClients: oldClients,
	}, true
}
