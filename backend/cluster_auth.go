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
	"github.com/wailsapp/wails/v2/pkg/runtime"
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
		runtime.EventsEmit(a.Ctx, "cluster:auth:recovered", map[string]any{
			"clusterId":   clusterID,
			"clusterName": clusterName,
		})
		// Rebuild only this cluster's subsystem
		go a.rebuildClusterSubsystem(clusterID)

	case authstate.StateRecovering:
		if a.logger != nil {
			a.logger.Warn(fmt.Sprintf("Cluster %s: auth recovering - %s", clusterName, reason), "Auth")
		}
		// Emit per-cluster recovering event for the frontend
		runtime.EventsEmit(a.Ctx, "cluster:auth:recovering", map[string]any{
			"clusterId":   clusterID,
			"clusterName": clusterName,
			"reason":      reason,
		})
		// Teardown only this cluster's subsystem
		go a.teardownClusterSubsystem(clusterID)

	case authstate.StateInvalid:
		if a.logger != nil {
			a.logger.Error(fmt.Sprintf("Cluster %s: auth failed - %s", clusterName, reason), "Auth")
		}
		// Emit per-cluster failure event for the frontend
		runtime.EventsEmit(a.Ctx, "cluster:auth:failed", map[string]any{
			"clusterId":   clusterID,
			"clusterName": clusterName,
			"reason":      reason,
		})
	}

	// Update aggregate connection status based on all clusters
	a.updateAggregateConnectionStatus()
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

// rebuildClusterSubsystem rebuilds the refresh subsystem for a specific cluster
// after auth recovery.
func (a *App) rebuildClusterSubsystem(clusterID string) {
	if a == nil || clusterID == "" {
		return
	}

	if a.logger != nil {
		a.logger.Info(fmt.Sprintf("Rebuilding subsystem for cluster %s", clusterID), "Auth")
	}

	// Get the cluster clients
	clients := a.clusterClientsForID(clusterID)
	if clients == nil {
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

	// Build the subsystem
	subsystem, err := a.buildRefreshSubsystemForSelection(selection, clients, clients.meta)
	if err != nil {
		if a.logger != nil {
			a.logger.Error(fmt.Sprintf("Failed to rebuild subsystem for cluster %s: %v", clusterID, err), "Auth")
		}
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

	if a.logger != nil {
		a.logger.Info(fmt.Sprintf("Successfully rebuilt subsystem for cluster %s", clusterID), "Auth")
	}
}

// updateAggregateConnectionStatus updates the global connection status based on
// the auth state of all clusters. The status reflects the "worst" state across
// all clusters.
func (a *App) updateAggregateConnectionStatus() {
	if a == nil {
		return
	}

	a.clusterClientsMu.Lock()
	defer a.clusterClientsMu.Unlock()

	// Check all clusters and find the worst state
	hasInvalid := false
	hasRecovering := false
	allValid := true

	for _, clients := range a.clusterClients {
		if clients == nil || clients.authManager == nil {
			continue
		}
		state, _ := clients.authManager.State()
		switch state {
		case authstate.StateInvalid:
			hasInvalid = true
			allValid = false
		case authstate.StateRecovering:
			hasRecovering = true
			allValid = false
		}
	}

	// Update global status based on aggregate state
	if hasInvalid {
		a.updateConnectionStatus(ConnectionStateAuthFailed, "One or more clusters have authentication failures", 0)
	} else if hasRecovering {
		a.updateConnectionStatus(ConnectionStateRetrying, "Recovering authentication for one or more clusters", 0)
	} else if allValid {
		a.updateConnectionStatus(ConnectionStateHealthy, "", 0)
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
func (a *App) GetAllClusterAuthStates() map[string]map[string]string {
	if a == nil {
		return nil
	}

	a.clusterClientsMu.Lock()
	defer a.clusterClientsMu.Unlock()

	states := make(map[string]map[string]string)
	for id, clients := range a.clusterClients {
		if clients == nil || clients.authManager == nil {
			states[id] = map[string]string{"state": "unknown", "reason": ""}
			continue
		}
		state, reason := clients.authManager.State()
		states[id] = map[string]string{
			"state":       state.String(),
			"reason":      reason,
			"clusterName": clients.meta.Name,
		}
	}
	return states
}
