package backend

import (
	"context"
	"fmt"
	"os"
	"sync"
	"time"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/internal/logsources"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/system"
)

// ResetRuntimeState unpublishes refresh transports before clearing transient
// resource caches and the app-owned cache tree. It is safe to call repeatedly.
func (a *RefreshCoordinator) ResetRuntimeState() error {
	if a == nil {
		return nil
	}
	a.teardownRefreshSubsystem()
	if a.resources != nil {
		a.resources.clearCaches()
	}
	if a.preferences == nil {
		return nil
	}
	cacheRoot, err := a.preferences.cacheDirPath()
	if err != nil {
		return err
	}
	return os.RemoveAll(cacheRoot)
}

func (a *RefreshCoordinator) teardownRefreshSubsystem() {
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

	a.setTelemetryRecorder(nil)
}

func (a *RefreshCoordinator) shutdownRefreshSubsystem(subsystem *system.Subsystem) {
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

func (a *RefreshCoordinator) stopRefreshPermissionRevalidation(clusterID string) {
	if a == nil || clusterID == "" {
		return
	}
	cancel := a.refreshPermissionCancels[clusterID]
	if cancel != nil {
		cancel()
	}
	delete(a.refreshPermissionCancels, clusterID)
}

func (a *RefreshCoordinator) clearRefreshPermissionCancels() {
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

func (a *RefreshCoordinator) handlePermissionIssues(issues []system.PermissionIssue) {
	if a == nil || a.logger == nil {
		return
	}
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
