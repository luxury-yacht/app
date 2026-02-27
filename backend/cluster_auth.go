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
	"github.com/luxury-yacht/app/backend/internal/errorcapture"
)

// handleClusterAuthStateChange handles auth state changes for a specific cluster.
// Unlike the global handleAuthStateChange, this only affects the specific cluster
// that experienced the auth failure, allowing other clusters to continue operating.
//
// NOTE: This is called from the auth manager with the mutex held, so heavy
// operations must be run asynchronously to avoid blocking other auth operations.
func (a *App) handleClusterAuthStateChange(clusterID string, state authstate.State, reason string) {
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
		if a.logger != nil {
			a.logger.Info(fmt.Sprintf("Cluster %s: auth recovered", clusterName), "Auth")
		}
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
		if a.logger != nil {
			a.logger.Warn(fmt.Sprintf("Cluster %s: auth recovering - %s", clusterName, reason), "Auth")
		}
		// Emit per-cluster recovering event for the frontend
		a.emitEvent("cluster:auth:recovering", map[string]any{
			"clusterId":   clusterID,
			"clusterName": clusterName,
			"reason":      reason,
		})
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
		if a.logger != nil {
			a.logger.Error(fmt.Sprintf("Cluster %s: auth failed - %s", clusterName, reason), "Auth")
		}
		// Capture the auth failure with cluster context for error enhancement
		errorcapture.CaptureWithCluster(clusterID, fmt.Sprintf("auth failed: %s", reason))
		// Emit per-cluster failure event for the frontend
		a.emitEvent("cluster:auth:failed", map[string]any{
			"clusterId":   clusterID,
			"clusterName": clusterName,
			"reason":      reason,
		})
	}
}

// teardownClusterSubsystem stops the refresh subsystem for a specific cluster
// without affecting other clusters.
func (a *App) teardownClusterSubsystem(clusterID string) {
	if a == nil || clusterID == "" {
		return
	}

	// Stop permission revalidation for this cluster
	a.stopRefreshPermissionRevalidation(clusterID)

	// Get and remove the subsystem for this cluster
	subsystem := a.refreshSubsystems[clusterID]
	if subsystem == nil {
		return
	}

	if a.logger != nil {
		a.logger.Info(fmt.Sprintf("Tearing down subsystem for cluster %s", clusterID), "Auth")
	}

	// Stop the resource stream if present
	if subsystem.ResourceStream != nil {
		subsystem.ResourceStream.Stop()
	}

	// Shutdown the manager with timeout
	const shutdownTimeout = time.Second
	if subsystem.Manager != nil {
		done := make(chan struct{})
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
			defer cancel()
			if err := subsystem.Manager.Shutdown(ctx); err != nil && a.logger != nil {
				a.logger.Warn(fmt.Sprintf("Failed to shutdown refresh manager for cluster %s: %v", clusterID, err), "Auth")
			}
			close(done)
		}()
		select {
		case <-done:
		case <-time.After(shutdownTimeout):
			if a.logger != nil {
				a.logger.Warn(fmt.Sprintf("Timed out waiting for refresh manager shutdown for cluster %s", clusterID), "Auth")
			}
		}
	}

	// Remove from the subsystems map
	delete(a.refreshSubsystems, clusterID)

	// Shutdown the informer factory if present
	if subsystem.InformerFactory != nil {
		_ = subsystem.InformerFactory.Shutdown()
	}
}

// rebuildClusterSubsystem rebuilds the cluster clients and refresh subsystem
// for a specific cluster after auth recovery. This rebuilds everything with
// fresh credentials from the kubeconfig to pick up refreshed SSO tokens.
func (a *App) rebuildClusterSubsystem(clusterID string) {
	if a == nil || clusterID == "" {
		return
	}

	if a.logger != nil {
		a.logger.Info(fmt.Sprintf("Rebuilding subsystem for cluster %s", clusterID), "Auth")
	}

	// Get the old cluster clients to preserve the auth manager
	oldClients := a.clusterClientsForID(clusterID)
	if oldClients == nil {
		if a.logger != nil {
			a.logger.Warn(fmt.Sprintf("Cannot rebuild subsystem for cluster %s: clients not found", clusterID), "Auth")
		}
		return
	}

	// Find the selection for this cluster
	selections, err := a.selectedKubeconfigSelections()
	if err != nil {
		if a.logger != nil {
			a.logger.Warn(fmt.Sprintf("Cannot rebuild subsystem for cluster %s: %v", clusterID, err), "Auth")
		}
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
		if a.logger != nil {
			a.logger.Warn(fmt.Sprintf("Cannot rebuild subsystem for cluster %s: selection not found", clusterID), "Auth")
		}
		return
	}

	// Rebuild the cluster clients with fresh credentials from kubeconfig.
	// This picks up refreshed SSO tokens that weren't available when the
	// original clients were created.
	newClients, err := a.buildClusterClients(selection, oldClients.meta)
	if err != nil {
		if a.logger != nil {
			a.logger.Error(fmt.Sprintf("Failed to rebuild clients for cluster %s: %v", clusterID, err), "Auth")
		}
		errorcapture.CaptureWithCluster(clusterID, fmt.Sprintf("client rebuild failed: %v", err))
		return
	}

	// Preserve the auth manager from the old clients (it's already in valid state)
	// and shutdown the new one we just created
	if newClients.authManager != nil {
		newClients.authManager.Shutdown()
	}
	newClients.authManager = oldClients.authManager
	newClients.authFailedOnInit = false // Clear the init failure flag

	// Update the cluster clients map
	a.clusterClientsMu.Lock()
	a.clusterClients[clusterID] = newClients
	a.clusterClientsMu.Unlock()

	// Build the subsystem with the new clients
	subsystem, err := a.buildRefreshSubsystemForSelection(selection, newClients, newClients.meta)
	if err != nil {
		if a.logger != nil {
			a.logger.Error(fmt.Sprintf("Failed to rebuild subsystem for cluster %s: %v", clusterID, err), "Auth")
		}
		errorcapture.CaptureWithCluster(clusterID, fmt.Sprintf("subsystem rebuild failed: %v", err))
		return
	}

	// Start the subsystem
	if a.refreshCtx != nil && subsystem.Manager != nil {
		go func() {
			if err := subsystem.Manager.Start(a.refreshCtx); err != nil && a.logger != nil {
				a.logger.Warn(fmt.Sprintf("Refresh manager for cluster %s stopped: %v", clusterID, err), "Auth")
			}
		}()
	}

	// Store the subsystem
	a.refreshSubsystems[clusterID] = subsystem

	// Build cluster order from current subsystems
	clusterOrder := make([]string, 0, len(a.refreshSubsystems))
	for id := range a.refreshSubsystems {
		clusterOrder = append(clusterOrder, id)
	}

	// If the HTTP server hasn't been started yet (e.g. all clusters had auth
	// failures during initial startup), bootstrap the full HTTP infrastructure
	// now that we have at least one working subsystem.
	if a.refreshHTTPServer == nil || a.refreshAggregates == nil {
		mux, aggregates, muxErr := a.buildRefreshMux(a.refreshSubsystems, clusterOrder)
		if muxErr != nil {
			if a.logger != nil {
				a.logger.Error(fmt.Sprintf("Failed to build refresh mux after cluster %s recovery: %v", clusterID, muxErr), "Auth")
			}
			return
		}
		a.refreshAggregates = aggregates
		if srvErr := a.startRefreshHTTPServer(mux, a.refreshSubsystems); srvErr != nil {
			if a.logger != nil {
				a.logger.Error(fmt.Sprintf("Failed to start refresh HTTP server after cluster %s recovery: %v", clusterID, srvErr), "Auth")
			}
			return
		}
		if a.logger != nil {
			a.logger.Info(fmt.Sprintf("Started refresh HTTP server after cluster %s recovery", clusterID), "Auth")
		}
	} else {
		// Update the aggregate handlers so they know about the new subsystem.
		if err := a.refreshAggregates.Update(clusterOrder, a.refreshSubsystems); err != nil {
			if a.logger != nil {
				a.logger.Error(fmt.Sprintf("Failed to update aggregates for cluster %s: %v", clusterID, err), "Auth")
			}
		}
	}

	// Start the object catalog for this cluster
	target := catalogTarget{
		selection: selection,
		meta:      newClients.meta,
	}
	if err := a.startObjectCatalogForTarget(target); err != nil && a.logger != nil {
		a.logger.Warn(fmt.Sprintf("Object catalog skipped for %s: %v", clusterID, err), "Auth")
	}

	if a.logger != nil {
		a.logger.Info(fmt.Sprintf("Successfully rebuilt subsystem for cluster %s", clusterID), "Auth")
	}
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
		state, reason := clients.authManager.State()
		info := clients.authManager.RecoveryInfo()
		states[id] = map[string]any{
			"state":             state.String(),
			"reason":            reason,
			"clusterName":       clients.meta.Name,
			"currentAttempt":    info.CurrentAttempt,
			"maxAttempts":       info.MaxAttempts,
			"secondsUntilRetry": info.SecondsUntilRetry,
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

	// Get cluster name for better logging/events
	clusterName := clusterID
	if clients := a.clusterClientsForID(clusterID); clients != nil {
		clusterName = clients.meta.Name
	}

	// Emit per-cluster progress event for the frontend
	a.emitEvent("cluster:auth:progress", map[string]any{
		"clusterId":         clusterID,
		"clusterName":       clusterName,
		"currentAttempt":    progress.CurrentAttempt,
		"maxAttempts":       progress.MaxAttempts,
		"secondsUntilRetry": progress.SecondsUntilRetry,
	})
}
