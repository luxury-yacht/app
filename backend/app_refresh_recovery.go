package backend

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/internal/logsources"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/system"
)

func (a *App) teardownRefreshSubsystem() {
	a.stopObjectCatalog()

	a.stopRefreshRuntimeContext()
	a.clearRefreshPermissionCancels()

	subsystems := a.replaceRefreshSubsystems(nil)
	a.refreshService.Store(nil)
	aggregates := a.refreshAggregates.Load()
	a.refreshAggregates.Store(nil)
	if aggregates != nil && aggregates.resources != nil {
		aggregates.resources.Stop()
	}

	for _, subsystem := range subsystems {
		a.shutdownRefreshSubsystem(subsystem)
	}

	a.refreshManager = nil

	a.sharedInformerFactory = nil
	a.apiExtensionsInformerFactory = nil
}

func (a *App) shutdownRefreshSubsystem(subsystem *system.Subsystem) {
	if subsystem == nil {
		return
	}
	a.stopRefreshSubsystemResources(subsystem)
	if subsystem.Manager == nil {
		return
	}
	done := make(chan struct{})
	go func(manager *refresh.Manager) {
		ctx, cancel := context.WithTimeout(context.Background(), config.RefreshShutdownTimeout)
		defer cancel()
		if err := manager.Shutdown(ctx); err != nil {
			a.logger.Warn(fmt.Sprintf("Failed to shutdown refresh manager: %v", err), logsources.Refresh)
		}
		close(done)
	}(subsystem.Manager)
	select {
	case <-done:
	case <-time.After(config.RefreshShutdownTimeout):
		a.logger.Warn("Timed out waiting for refresh manager shutdown", logsources.Refresh)
	}
}

func (a *App) stopRefreshPermissionRevalidation(clusterID string) {
	if a == nil || clusterID == "" {
		return
	}
	cancel := a.refreshPermissionCancels[clusterID]
	if cancel != nil {
		cancel()
	}
	delete(a.refreshPermissionCancels, clusterID)
}

func (a *App) clearRefreshPermissionCancels() {
	if a == nil || len(a.refreshPermissionCancels) == 0 {
		return
	}
	for id, cancel := range a.refreshPermissionCancels {
		if cancel != nil {
			cancel()
		}
		delete(a.refreshPermissionCancels, id)
	}
}

func (a *App) handlePermissionIssues(issues []system.PermissionIssue) {
	for _, issue := range issues {
		if issue.Err == nil {
			continue
		}
		a.logger.Warn(
			fmt.Sprintf("Refresh domain %s unavailable (%s): %v", issue.Domain, issue.Resource, issue.Err),
			"Refresh",
		)
		// NOTE: Per-cluster auth recovery is now handled by the auth manager via 401 responses.
		// Permission issues without cluster context are logged but not auto-recovered.
	}
}

// transportFailureState tracks transport failures for a single cluster.
// This allows isolated recovery per-cluster without affecting other clusters.
type transportFailureState struct {
	mu                sync.Mutex
	failureCount      int
	windowStart       time.Time
	rebuildInProgress bool
	lastRebuild       time.Time
}

// getTransportState returns the transport failure state for a given cluster,
// creating a new one if it doesn't exist. This method is thread-safe and
// lazily initializes the transportStates map if needed.
func (a *App) getTransportState(clusterID string) *transportFailureState {
	a.transportStatesMu.Lock()
	defer a.transportStatesMu.Unlock()
	if a.transportStates == nil {
		a.transportStates = make(map[string]*transportFailureState)
	}
	if a.transportStates[clusterID] == nil {
		a.transportStates[clusterID] = &transportFailureState{}
	}
	return a.transportStates[clusterID]
}

// recordClusterTransportFailure records a transport failure for a specific cluster.
// If the failure threshold is reached within the time window, it triggers a
// per-cluster rebuild. This isolates failures so one cluster's problems don't
// affect others.
func (a *App) recordClusterTransportFailure(clusterID, reason string, err error) {
	if a == nil {
		return
	}
	state := a.getTransportState(clusterID)
	state.mu.Lock()

	now := time.Now()
	if now.Sub(state.windowStart) > config.ClusterTransportFailureWindow {
		state.failureCount = 0
		state.windowStart = now
	}

	state.failureCount++
	count := state.failureCount

	shouldTrigger := count >= config.ClusterTransportFailureThreshold &&
		!state.rebuildInProgress &&
		now.Sub(state.lastRebuild) >= config.ClusterTransportRebuildCooldown
	if shouldTrigger {
		state.rebuildInProgress = true
		state.lastRebuild = now
	}
	state.mu.Unlock()

	if shouldTrigger {
		a.logger.Warn(fmt.Sprintf("Transport connectivity degraded for cluster %s (%s); rebuilding", clusterID, reason), logsources.KubernetesClient, clusterID, a.clusterNameForID(clusterID))
		go a.runClusterTransportRebuild(clusterID, reason, err)
	}
}

// recordClusterTransportSuccess records a successful transport operation for
// a specific cluster, resetting its failure count.
func (a *App) recordClusterTransportSuccess(clusterID string) {
	if a == nil {
		return
	}
	state := a.getTransportState(clusterID)
	state.mu.Lock()
	defer state.mu.Unlock()
	state.failureCount = 0
}

// runClusterTransportRebuild performs a transport rebuild for a specific cluster.
// It uses the existing rebuildClusterSubsystem which rebuilds only that cluster.
func (a *App) runClusterTransportRebuild(clusterID, reason string, cause error) {
	if err := a.runSelectionMutation(
		fmt.Sprintf("cluster-transport-rebuild:%s", clusterID),
		func(_ *selectionMutation) error {
			return a.rebuildClusterTransport(clusterID, reason, cause)
		},
	); err != nil {
		a.logger.Warn(fmt.Sprintf("Transport rebuild coordination failed for cluster %s: %v", clusterID, err), logsources.KubernetesClient, clusterID, a.clusterNameForID(clusterID))
	}
}

func (a *App) rebuildClusterTransport(clusterID, reason string, cause error) error {
	state := a.getTransportState(clusterID)
	defer func() {
		state.mu.Lock()
		state.failureCount = 0
		state.windowStart = time.Time{}
		state.rebuildInProgress = false
		state.mu.Unlock()
	}()

	if a.telemetryRecorder != nil {
		a.telemetryRecorder.RecordTransportRebuild(fmt.Sprintf("cluster:%s - %s", clusterID, reason))
	}
	a.logger.Info(fmt.Sprintf("Starting transport rebuild for cluster %s", clusterID), logsources.KubernetesClient, clusterID, a.clusterNameForID(clusterID))

	if err := a.runClusterOperation(context.Background(), clusterID, func(opCtx context.Context) error {
		if err := opCtx.Err(); err != nil {
			return err
		}
		a.rebuildClusterSubsystem(clusterID)
		return opCtx.Err()
	}); err != nil {
		return err
	}

	if a.logger != nil {
		message := fmt.Sprintf("Transport rebuild complete for cluster %s", clusterID)
		if cause != nil {
			message = fmt.Sprintf("%s after %v", message, cause)
		}
		a.logger.Info(message, logsources.KubernetesClient, clusterID, a.clusterNameForID(clusterID))
	}
	return nil
}
