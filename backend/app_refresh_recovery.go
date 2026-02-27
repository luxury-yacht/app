package backend

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/system"
)

func (a *App) teardownRefreshSubsystem() {
	a.stopObjectCatalog()

	if a.refreshCancel != nil {
		a.refreshCancel()
		a.refreshCancel = nil
	}
	a.refreshCtx = nil
	a.clearRefreshPermissionCancels()

	// Use timeout context for shutdown operations to prevent indefinite blocking
	const shutdownTimeout = time.Second

	subsystems := a.refreshSubsystems

	for _, subsystem := range subsystems {
		if subsystem == nil || subsystem.Manager == nil {
			continue
		}
		if subsystem.ResourceStream != nil {
			subsystem.ResourceStream.Stop()
		}
		done := make(chan struct{})
		go func(manager *refresh.Manager) {
			ctx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
			defer cancel()
			if err := manager.Shutdown(ctx); err != nil && a.logger != nil {
				a.logger.Warn(fmt.Sprintf("Failed to shutdown refresh manager: %v", err), "Refresh")
			}
			close(done)
		}(subsystem.Manager)
		select {
		case <-done:
		case <-time.After(shutdownTimeout):
			if a.logger != nil {
				a.logger.Warn("Timed out waiting for refresh manager shutdown", "Refresh")
			}
		}
	}

	a.refreshSubsystems = make(map[string]*system.Subsystem)
	a.refreshManager = nil
	a.refreshAggregates = nil

	serverDone := a.refreshServerDone
	if a.refreshHTTPServer != nil {
		done := make(chan struct{})
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
			defer cancel()
			if err := a.refreshHTTPServer.Shutdown(ctx); err != nil && !errors.Is(err, http.ErrServerClosed) {
				if a.logger != nil {
					a.logger.Warn(fmt.Sprintf("Failed to shutdown refresh HTTP server: %v", err), "Refresh")
				}
			}
			close(done)
		}()
		select {
		case <-done:
		case <-time.After(shutdownTimeout):
			if a.logger != nil {
				a.logger.Warn("Timed out waiting for refresh HTTP server shutdown", "Refresh")
			}
		}
		a.refreshHTTPServer = nil
	}

	if serverDone != nil {
		select {
		case <-serverDone:
		case <-time.After(time.Second):
			if a.logger != nil {
				a.logger.Warn("Timed out waiting for refresh server loop", "Refresh")
			}
		}
	}
	a.refreshServerDone = nil

	if a.refreshListener != nil {
		if err := a.refreshListener.Close(); err != nil && a.logger != nil {
			a.logger.Debug(fmt.Sprintf("Failed to close refresh listener: %v", err), "Refresh")
		}
		a.refreshListener = nil
	}

	a.sharedInformerFactory = nil
	a.apiExtensionsInformerFactory = nil
	a.refreshBaseURL = ""
	clearGVRCache()
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

// Transport failure tracking constants used by per-cluster functions.
const (
	transportFailureThreshold = 3
	transportFailureWindow    = 30 * time.Second
	transportRebuildCooldown  = time.Minute
)

// initAuthRecoveryState initializes the per-cluster auth recovery scheduling map.
// Safe to call multiple times.
func (a *App) initAuthRecoveryState() {
	a.clusterAuthRecoveryMu.Lock()
	defer a.clusterAuthRecoveryMu.Unlock()
	if a.clusterAuthRecoveryScheduled == nil {
		a.clusterAuthRecoveryScheduled = make(map[string]bool)
	}
}

// scheduleClusterAuthRecovery marks a cluster as having auth recovery scheduled.
// Returns true if newly scheduled, false if already scheduled.
// This allows per-cluster auth recovery scheduling without affecting other clusters.
func (a *App) scheduleClusterAuthRecovery(clusterID string) bool {
	a.clusterAuthRecoveryMu.Lock()
	defer a.clusterAuthRecoveryMu.Unlock()

	// Lazy initialization if not already done
	if a.clusterAuthRecoveryScheduled == nil {
		a.clusterAuthRecoveryScheduled = make(map[string]bool)
	}

	if a.clusterAuthRecoveryScheduled[clusterID] {
		return false // Already scheduled
	}

	a.clusterAuthRecoveryScheduled[clusterID] = true
	return true
}

// clearClusterAuthRecoveryScheduled clears the auth recovery scheduled flag for a cluster.
// Called when auth recovery completes (successfully or not) for that cluster.
func (a *App) clearClusterAuthRecoveryScheduled(clusterID string) {
	a.clusterAuthRecoveryMu.Lock()
	defer a.clusterAuthRecoveryMu.Unlock()
	delete(a.clusterAuthRecoveryScheduled, clusterID)
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

// initTransportStates initializes the per-cluster transport state map.
// Safe to call multiple times.
func (a *App) initTransportStates() {
	a.transportStatesMu.Lock()
	defer a.transportStatesMu.Unlock()
	if a.transportStates == nil {
		a.transportStates = make(map[string]*transportFailureState)
	}
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
	// Reset window if expired (uses same window as global tracking: 30 seconds)
	if now.Sub(state.windowStart) > transportFailureWindow {
		state.failureCount = 0
		state.windowStart = now
	}

	state.failureCount++
	count := state.failureCount

	// Check if threshold reached (same as global: 3 failures)
	shouldTrigger := count >= transportFailureThreshold &&
		!state.rebuildInProgress &&
		now.Sub(state.lastRebuild) >= transportRebuildCooldown
	if shouldTrigger {
		state.rebuildInProgress = true
		state.lastRebuild = now
	}
	state.mu.Unlock()

	if shouldTrigger {
		if a.logger != nil {
			a.logger.Warn(fmt.Sprintf("Transport connectivity degraded for cluster %s (%s); rebuilding", clusterID, reason), "KubernetesClient")
		}
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
		func(_ selectionMutation) error {
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

			if a.logger != nil {
				a.logger.Info(fmt.Sprintf("Starting transport rebuild for cluster %s", clusterID), "KubernetesClient")
			}

			// Use existing per-cluster rebuild mechanism.
			a.rebuildClusterSubsystem(clusterID)

			if a.logger != nil {
				msg := fmt.Sprintf("Transport rebuild complete for cluster %s", clusterID)
				if cause != nil {
					msg = fmt.Sprintf("%s after %v", msg, cause)
				}
				a.logger.Info(msg, "KubernetesClient")
			}
			return nil
		},
	); err != nil && a.logger != nil {
		a.logger.Warn(fmt.Sprintf("Transport rebuild coordination failed for cluster %s: %v", clusterID, err), "KubernetesClient")
	}
}
