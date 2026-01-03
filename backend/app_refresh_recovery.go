package backend

import (
	"context"
	"errors"
	"fmt"
	"net/http"
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

	// Use timeout context for shutdown operations to prevent indefinite blocking
	const shutdownTimeout = time.Second

	subsystems := a.refreshSubsystems
	if len(subsystems) == 0 && a.refreshManager != nil {
		subsystems = map[string]*system.Subsystem{"standalone": {Manager: a.refreshManager}}
	}

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
	// Legacy permission caches are unused; retain clearing for safety.
	a.clearPermissionCaches()
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
		a.scheduleAuthRecovery(issue)
	}
}

func (a *App) scheduleAuthRecovery(issue system.PermissionIssue) {
	a.authRecoveryMu.Lock()
	if a.authRecoveryScheduled {
		a.authRecoveryMu.Unlock()
		return
	}
	a.authRecoveryScheduled = true
	a.authRecoveryMu.Unlock()

	reason := fmt.Sprintf("%s (%s)", issue.Domain, issue.Resource)
	a.updateConnectionStatus(ConnectionStateAuthFailed, fmt.Sprintf("Authentication required for %s", reason), 0)
	if a.startAuthRecovery != nil {
		a.startAuthRecovery(reason)
	} else {
		go a.runAuthRecovery(reason)
	}
}

func (a *App) runAuthRecovery(reason string) {
	defer func() {
		a.authRecoveryMu.Lock()
		a.authRecoveryScheduled = false
		a.authRecoveryMu.Unlock()
	}()

	backoff := 5 * time.Second
	for {
		select {
		case <-a.Ctx.Done():
			return
		case <-time.After(backoff):
		}

		if err := a.rebuildRefreshSubsystem(reason); err != nil {
			a.logger.Warn(fmt.Sprintf("Refresh subsystem recovery attempt failed: %v", err), "Refresh")
			if backoff < time.Minute {
				backoff *= 2
			}
			continue
		}

		a.logger.Info("Refresh subsystem recovered after authentication failure", "Refresh")
		a.updateConnectionStatus(ConnectionStateHealthy, "", 0)
		return
	}
}

func (a *App) rebuildRefreshSubsystem(reason string) error {
	a.logger.Info(fmt.Sprintf("Rebuilding refresh subsystem (%s)", reason), "Refresh")
	a.teardownRefreshSubsystem()

	a.client = nil
	a.apiextensionsClient = nil
	a.dynamicClient = nil
	a.metricsClient = nil
	a.restConfig = nil

	if err := a.initKubeClient(); err != nil {
		return err
	}

	return nil
}

const (
	transportFailureThreshold = 3
	transportFailureWindow    = 30 * time.Second
	transportRebuildCooldown  = time.Minute
)

func (a *App) recordTransportSuccess() {
	if a == nil {
		return
	}
	a.transportMu.Lock()
	a.transportFailureCount = 0
	a.transportWindowStart = time.Time{}
	a.transportMu.Unlock()
	a.updateConnectionStatus(ConnectionStateHealthy, "", 0)
}

func (a *App) recordTransportFailure(reason string, err error) {
	if a == nil {
		return
	}
	a.transportMu.Lock()
	now := time.Now()
	if a.transportFailureCount == 0 || now.Sub(a.transportWindowStart) > transportFailureWindow {
		a.transportFailureCount = 0
		a.transportWindowStart = now
	}
	a.transportFailureCount++
	count := a.transportFailureCount
	shouldTrigger := count >= transportFailureThreshold &&
		!a.transportRebuildInProgress &&
		now.Sub(a.lastTransportRebuild) >= transportRebuildCooldown
	if shouldTrigger {
		a.transportRebuildInProgress = true
		a.lastTransportRebuild = now
	}
	a.transportMu.Unlock()

	if shouldTrigger {
		a.updateConnectionStatus(ConnectionStateRebuilding, fmt.Sprintf("Rebuilding after %s", reason), 0)
		if a.logger != nil {
			a.logger.Warn(fmt.Sprintf("Transport connectivity degraded (%s); rebuilding Kubernetes clients", reason), "KubernetesClient")
		}
		go a.runTransportRebuild(fmt.Sprintf("transport failure (%s)", reason), err)
	}
}

func (a *App) runTransportRebuild(reason string, cause error) {
	defer func() {
		a.transportMu.Lock()
		a.transportFailureCount = 0
		a.transportWindowStart = time.Time{}
		a.transportRebuildInProgress = false
		a.transportMu.Unlock()
	}()

	if a.telemetryRecorder != nil {
		a.telemetryRecorder.RecordTransportRebuild(reason)
	}
	if err := a.rebuildRefreshSubsystem(reason); err != nil {
		if a.logger != nil {
			a.logger.Warn(fmt.Sprintf("Transport rebuild failed: %v", err), "KubernetesClient")
		}
		a.updateConnectionStatus(ConnectionStateOffline, err.Error(), 0)
		return
	}
	if a.logger != nil {
		msg := "Transport rebuild complete"
		if cause != nil {
			msg = fmt.Sprintf("%s after %v", msg, cause)
		}
		a.logger.Info(msg, "KubernetesClient")
	}
	a.updateConnectionStatus(ConnectionStateHealthy, "", 0)
}
