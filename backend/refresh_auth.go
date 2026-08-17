package backend

import (
	"context"
	"fmt"
	"time"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/internal/logsources"
	"github.com/luxury-yacht/app/backend/refresh/system"
)

// stopClusterFeeds stops everything that FEEDS a cluster's subsystem — permission
// revalidation, the resource stream, the refresh manager (which also stops the metrics
// poller and informer hub), and the informer factory — WITHOUT removing the subsystem from
// the registry and WITHOUT spilling. It is the shared stop logic for two callers:
//   - teardownClusterSubsystem, which then takes the subsystem + spills (full teardown), and
//   - coolClusterToMmapServing, which then swaps the maintained stores to mmap and keeps the
//     subsystem registered so it serves cooled queries.
//
// The subsystem must be the one currently registered for clusterID; the caller passes it so
// cool can act on the same subsystem it will keep serving.
func (a *RefreshCoordinator) stopClusterFeeds(clusterID string, subsystem *system.Subsystem) {
	if a == nil || clusterID == "" || subsystem == nil {
		return
	}
	subsystem.CancelColdPreparation()

	// Stop permission revalidation for this cluster.
	a.stopRefreshPermissionRevalidation(clusterID)

	// Silence the doorbell notifiers (namespaces, object-events) BEFORE the
	// stream manager stops: their debounce/rearm timers outlive the informers
	// and would keep broadcasting into the dead manager.
	subsystem.StopDoorbellNotifiers()

	// Stop active streams before shutting down their producers.
	if subsystem.ContainerLogs != nil {
		subsystem.ContainerLogs.Stop()
	}
	if subsystem.ResourceStream != nil {
		subsystem.ResourceStream.Stop()
	}

	if subsystem.Manager != nil {
		done := make(chan struct{})
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), config.RefreshShutdownTimeout)
			defer cancel()
			if err := subsystem.Manager.Shutdown(ctx); err != nil {
				a.logger.Warn(fmt.Sprintf("Failed to shutdown refresh manager for cluster %s: %v", clusterID, err), logsources.Auth, clusterID, clusterID)
			}
			close(done)
		}()
		select {
		case <-done:
		case <-time.After(config.RefreshShutdownTimeout):
			a.logger.Warn(fmt.Sprintf("Timed out waiting for refresh manager shutdown for cluster %s", clusterID), logsources.Auth, clusterID, clusterID)
		}
	}

	// Shutdown the informer factory if present.
	if subsystem.InformerFactory != nil {
		_ = subsystem.InformerFactory.Shutdown()
	}
}

// teardownClusterSubsystem stops the refresh subsystem for a specific cluster
// without affecting other clusters.
func (a *RefreshCoordinator) teardownClusterSubsystem(clusterID string) {
	if a == nil || clusterID == "" {
		return
	}

	// A cluster torn down while cooled (e.g. closed, or pressure-collapsed after cooling)
	// must release its mmap mappings FIRST, before its stores are discarded — otherwise the
	// closers would never run. takeCooledClosers returns each closer exactly once, so this
	// never double-unmaps a subsequent re-warm.
	a.closeCooledClosers(clusterID)

	// Get and remove the subsystem for this cluster.
	subsystem := a.takeRefreshSubsystem(clusterID)
	if subsystem == nil {
		// No live subsystem; still ensure permission revalidation is stopped (takeRefreshSubsystem
		// short-circuits stopClusterFeeds below, which is where reval stop lives).
		a.stopRefreshPermissionRevalidation(clusterID)
		return
	}

	a.logger.Info(fmt.Sprintf("Tearing down subsystem for cluster %s", clusterID), logsources.Auth, clusterID, clusterID)

	// Stop all feeds (permission reval, resource stream, manager, informer factory).
	a.stopClusterFeeds(clusterID, subsystem)

	// Spill this cluster's stores to disk now that the subsystem is quiescent, so a re-warm
	// re-paints them fast before its informers re-sync (the heap they hold is reclaimed by the
	// governor's Cold action right after this returns). The maintained query stores give the
	// instant warm-paint; the ingest stores (+ their RV) let each reflector resume from a
	// delta instead of a full re-LIST.
	a.spillClusterStores(clusterID, subsystem.Registry)
	a.spillClusterIngestStores(clusterID, subsystem.IngestManager)
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
