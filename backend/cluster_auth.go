/*
 * backend/cluster_auth.go
 *
 * Per-cluster authentication state management.
 * Handles auth failures and recovery independently for each cluster,
 * so auth issues in one cluster don't affect other clusters.
 */

package backend

import (
	"context"
	"fmt"
	"time"

	"github.com/luxury-yacht/app/backend/internal/authstate"
	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/internal/errorcapture"
	"github.com/luxury-yacht/app/backend/internal/logsources"
	"github.com/luxury-yacht/app/backend/refresh/system"
)

// handleClusterAuthStateChange handles auth state changes for a specific cluster.
// Unlike the global handleAuthStateChange, this only affects the specific cluster
// that experienced the auth failure, allowing other clusters to continue operating.
//
// NOTE: This is called from the auth manager with the mutex held, so heavy
// operations must be run asynchronously to avoid blocking other auth operations.
func (a *App) handleClusterAuthStateChange(clusterID string, state authstate.State, diag authstate.FailureDiagnostic) {
	if a == nil || clusterID == "" {
		return
	}

	// Get cluster name for better logging/events
	clusterName := clusterID
	if clients := a.clusterClientsForID(clusterID); clients != nil {
		clusterName = clients.meta.Name
	}

	switch state {
	case authstate.StateValid:
		a.logger.Info(fmt.Sprintf("Cluster %s: auth recovered", clusterName), logsources.Auth, clusterID, clusterName)
		// Emit per-cluster recovery event for the frontend
		a.emitEvent("cluster:auth:recovered", map[string]any{
			"clusterId":   clusterID,
			"clusterName": clusterName,
		})
		// Rebuild only this cluster's subsystem through the coordinated mutation path.
		a.runSelectionMutationAsync(fmt.Sprintf("cluster-auth-rebuild:%s", clusterID), func(_ *selectionMutation) error {
			return a.runClusterOperation(context.Background(), clusterID, func(opCtx context.Context) error {
				if err := opCtx.Err(); err != nil {
					return err
				}
				a.rebuildClusterSubsystem(clusterID)
				return opCtx.Err()
			})
		})

	case authstate.StateRecovering:
		a.logger.Warn(fmt.Sprintf("Cluster %s: auth recovering - %s", clusterName, diag.Reason), logsources.Auth, clusterID, clusterName)
		// Emit per-cluster recovering event for the frontend
		a.emitEvent("cluster:auth:recovering", authEventPayload(clusterID, clusterName, diag))
		// Teardown only this cluster's subsystem through the coordinated mutation path.
		a.runSelectionMutationAsync(fmt.Sprintf("cluster-auth-teardown:%s", clusterID), func(_ *selectionMutation) error {
			return a.runClusterOperation(context.Background(), clusterID, func(opCtx context.Context) error {
				if err := opCtx.Err(); err != nil {
					return err
				}
				a.teardownClusterSubsystem(clusterID)
				return opCtx.Err()
			})
		})

	case authstate.StateInvalid:
		a.logger.Error(fmt.Sprintf("Cluster %s: auth failed - %s", clusterName, diag.Reason), logsources.Auth, clusterID, clusterName)
		// Capture the auth failure with cluster context for error enhancement
		errorcapture.CaptureWithCluster(clusterID, fmt.Sprintf("auth failed: %s", diag.Reason))
		// Emit per-cluster failure event for the frontend
		a.emitEvent("cluster:auth:failed", authEventPayload(clusterID, clusterName, diag))
		if a.clusterLifecycle != nil {
			a.clusterLifecycle.SetState(clusterID, ClusterStateAuthFailed)
		}
	}
}

// authEventPayload builds an auth event payload carrying the per-cluster identity
// plus the typed credential diagnostic. Every diagnostic field is always present
// (empty string when unknown) so the frontend can rely on the payload shape.
func authEventPayload(clusterID, clusterName string, diag authstate.FailureDiagnostic) map[string]any {
	return map[string]any{
		"clusterId":   clusterID,
		"clusterName": clusterName,
		"reason":      diag.Reason,
		"class":       diag.Class,
		"kind":        diag.Kind,
		"summary":     diag.Summary,
		"execCommand": diag.ExecCommand,
	}
}

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
func (a *App) stopClusterFeeds(clusterID string, subsystem *system.Subsystem) {
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

	// Stop the resource stream if present.
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
func (a *App) teardownClusterSubsystem(clusterID string) {
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
func (a *App) rebuildClusterSubsystem(clusterID string) {
	if a == nil || clusterID == "" {
		return
	}

	a.logger.Info(fmt.Sprintf("Rebuilding subsystem for cluster %s", clusterID), logsources.Auth, clusterID, clusterID)

	// Get the old cluster clients to preserve the auth manager
	oldClients := a.clusterClientsForID(clusterID)
	if oldClients == nil {
		a.logger.Warn(fmt.Sprintf("Cannot rebuild subsystem for cluster %s: clients not found", clusterID), logsources.Auth, clusterID, clusterID)
		return
	}
	clusterName := oldClients.meta.Name

	// Find the selection for this cluster
	selections, err := a.selectedKubeconfigSelections()
	if err != nil {
		a.logger.Warn(fmt.Sprintf("Cannot rebuild subsystem for cluster %s: %v", clusterID, err), logsources.Auth, clusterID, clusterName)
		return
	}

	var selection kubeconfigSelection
	for _, sel := range selections {
		meta := a.clusterMetaForSelection(sel)
		if meta.ID == clusterID {
			selection = sel
			break
		}
	}

	if selection.Path == "" {
		a.logger.Warn(fmt.Sprintf("Cannot rebuild subsystem for cluster %s: selection not found", clusterID), logsources.Auth, clusterID, clusterName)
		return
	}

	// Rebuild the cluster clients with fresh credentials from kubeconfig.
	// This picks up refreshed SSO tokens that weren't available when the
	// original clients were created. The existing auth manager is reused so
	// the rebuilt transports keep reporting to the manager the app tracks —
	// wiring them to a fresh manager and swapping afterwards would leave the
	// transports pointing at a discarded manager that can never recover.
	newClients, err := a.buildClusterClientsWithManager(context.Background(), selection, oldClients.meta, oldClients.authManager)
	if err != nil {
		a.logger.Error(fmt.Sprintf("Failed to rebuild clients for cluster %s: %v", clusterID, err), logsources.Auth, clusterID, clusterName)
		errorcapture.CaptureWithCluster(clusterID, fmt.Sprintf("client rebuild failed: %v", err))
		return
	}

	// Update the cluster clients map
	a.clusterClientsMu.Lock()
	a.clusterClients[clusterID] = newClients
	a.clusterClientsMu.Unlock()

	// If the preflight reported an auth failure, stop here: the auth manager's
	// recovery cycle owns the next rebuild attempt once credentials are valid.
	if newClients.authFailedOnInit || (newClients.authManager != nil && !newClients.authManager.IsValid()) {
		a.logger.Warn(fmt.Sprintf("Skipping subsystem rebuild for cluster %s: auth not valid after client rebuild", clusterID), logsources.Auth, clusterID, clusterName)
		return
	}

	// Build the subsystem with the new clients
	subsystem, err := a.buildRefreshSubsystemForSelection(selection, newClients, newClients.meta)
	if err != nil {
		a.logger.Error(fmt.Sprintf("Failed to rebuild subsystem for cluster %s: %v", clusterID, err), logsources.Auth, clusterID, clusterName)
		errorcapture.CaptureWithCluster(clusterID, fmt.Sprintf("subsystem rebuild failed: %v", err))
		return
	}

	// (The maintained stores were already warm-painted from disk inside
	// buildRefreshSubsystemForSelection, before the manager starts — shared by every build path.)

	// Start the subsystem
	if a.refreshCtx != nil && subsystem.Manager != nil {
		registry := subsystem.Registry
		go func() {
			if err := subsystem.Manager.Start(a.refreshCtx); err != nil {
				a.logger.Warn(fmt.Sprintf("Refresh manager for cluster %s stopped: %v", clusterID, err), logsources.Auth, clusterID, clusterName)
				return
			}
			// Manager.Start blocks until the informer hub has synced (factory + ingest), so
			// the live caches are now populated: reconcile away any row warm-painted from a
			// stale spill whose object was deleted while the cluster was Cold. Ingest-fed
			// stores already reconciled via their reflector's initial Replace; this covers
			// the shared-informer-fed kinds (HPA, Gateway-API, CRDs, events, …).
			if registry != nil {
				registry.ReconcileMaintainedStores()
			}
		}()
	}

	// Store the subsystem, stopping the previous one — overwriting the entry
	// would leak its informers/reflectors/notifier on stale transports.
	a.swapRefreshSubsystem(clusterID, subsystem)

	// Build cluster order from current subsystems
	subsystems := a.snapshotRefreshSubsystems()
	clusterOrder := make([]string, 0, len(subsystems))
	for id := range subsystems {
		clusterOrder = append(clusterOrder, id)
	}

	// If the HTTP server hasn't been started yet (e.g. all clusters had auth
	// failures during initial startup), bootstrap the full HTTP infrastructure
	// now that we have at least one working subsystem.
	if a.refreshHTTPServer == nil || a.refreshAggregates.Load() == nil {
		mux, aggregates, muxErr := a.buildRefreshMux(subsystems, clusterOrder)
		if muxErr != nil {
			a.logger.Error(fmt.Sprintf("Failed to build refresh mux after cluster %s recovery: %v", clusterID, muxErr), logsources.Auth, clusterID, clusterName)
			return
		}
		a.refreshAggregates.Store(aggregates)
		// Heal any readiness settle-ring dropped while aggregates were nil.
		a.sweepNamespacesReadiness(subsystems)
		if srvErr := a.startRefreshHTTPServer(mux, subsystems); srvErr != nil {
			a.logger.Error(fmt.Sprintf("Failed to start refresh HTTP server after cluster %s recovery: %v", clusterID, srvErr), logsources.Auth, clusterID, clusterName)
			return
		}
		a.logger.Info(fmt.Sprintf("Started refresh HTTP server after cluster %s recovery", clusterID), logsources.Auth, clusterID, clusterName)
	} else {
		// Update the aggregate handlers so they know about the new subsystem.
		if err := a.refreshAggregates.Load().Update(clusterOrder, subsystems); err != nil {
			a.logger.Error(fmt.Sprintf("Failed to update aggregates for cluster %s: %v", clusterID, err), logsources.Auth, clusterID, clusterName)
		}
	}

	// Start the object catalog for this cluster
	target := catalogTarget{
		selection: selection,
		meta:      newClients.meta,
	}
	if err := a.startObjectCatalogForTarget(target); err != nil {
		a.logger.Warn(fmt.Sprintf("Object catalog skipped for %s: %v", clusterID, err), logsources.Auth, clusterID, clusterName)
	}

	a.logger.Info(fmt.Sprintf("Successfully rebuilt subsystem for cluster %s", clusterID), logsources.Auth, clusterID, clusterName)
}

// RetryClusterAuth triggers a manual authentication recovery attempt for a specific cluster.
// Called when user clicks "Retry" for a specific cluster after re-authenticating externally.
func (a *App) RetryClusterAuth(clusterID string) {
	if a == nil || clusterID == "" {
		return
	}

	clients := a.clusterClientsForID(clusterID)
	if clients == nil || clients.authManager == nil {
		return
	}

	clients.authManager.TriggerRetry()
}

// GetClusterAuthState returns the current auth state for a specific cluster.
func (a *App) GetClusterAuthState(clusterID string) (string, string) {
	if a == nil || clusterID == "" {
		return "unknown", ""
	}

	clients := a.clusterClientsForID(clusterID)
	if clients == nil || clients.authManager == nil {
		return "unknown", ""
	}

	state, reason := clients.authManager.State()
	return state.String(), reason
}

// GetAllClusterAuthStates returns the auth state for all clusters.
func (a *App) GetAllClusterAuthStates() map[string]map[string]any {
	if a == nil {
		return nil
	}

	a.clusterClientsMu.Lock()
	defer a.clusterClientsMu.Unlock()

	states := make(map[string]map[string]any)
	for id, clients := range a.clusterClients {
		if clients == nil || clients.authManager == nil {
			states[id] = map[string]any{"state": "unknown", "reason": ""}
			continue
		}
		state, _ := clients.authManager.State()
		diag := clients.authManager.FailureDiagnostic()
		info := clients.authManager.RecoveryInfo()
		states[id] = map[string]any{
			"state":             state.String(),
			"reason":            diag.Reason,
			"clusterName":       clients.meta.Name,
			"secondsUntilRetry": info.SecondsUntilRetry,
			"errorClass":        string(info.ErrorClass),
			"class":             diag.Class,
			"kind":              diag.Kind,
			"summary":           diag.Summary,
			"execCommand":       diag.ExecCommand,
		}
	}
	return states
}

// handleClusterAuthRecoveryProgress handles recovery progress updates for a specific cluster.
// This is called periodically during recovery to allow the frontend to show countdowns.
func (a *App) handleClusterAuthRecoveryProgress(clusterID string, progress authstate.RecoveryProgress) {
	if a == nil || clusterID == "" {
		return
	}

	// Get cluster name and the stored failure diagnostic. FailureDiagnostic is
	// read outside the manager's lock (OnRecoveryProgress fires after emitProgress
	// releases it), so this cannot deadlock.
	clusterName := clusterID
	var diag authstate.FailureDiagnostic
	if clients := a.clusterClientsForID(clusterID); clients != nil {
		clusterName = clients.meta.Name
		if clients.authManager != nil {
			diag = clients.authManager.FailureDiagnostic()
		}
	}

	// Emit per-cluster progress event for the frontend. errorClass carries the
	// latest probe verdict ("auth", "connectivity", or "" before any verdict)
	// so the UI can distinguish an unreachable cluster from rejected credentials.
	// The typed diagnostic fields let a late-subscribing UI render exec-helper
	// copy without having seen the failed/recovering event.
	payload := authEventPayload(clusterID, clusterName, diag)
	payload["secondsUntilRetry"] = progress.SecondsUntilRetry
	payload["errorClass"] = string(progress.ErrorClass)
	a.emitEvent("cluster:auth:progress", payload)
}
