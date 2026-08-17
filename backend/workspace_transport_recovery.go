package backend

import (
	"context"
	"fmt"
	"time"

	"github.com/luxury-yacht/app/backend/internal/logsources"
)

// runClusterTransportRebuild performs a transport rebuild for a specific cluster.
// It uses the existing rebuildClusterSubsystem which rebuilds only that cluster.
func (a *WorkspaceCoordinator) runClusterTransportRebuild(clusterID, reason string, cause error) {
	if err := a.runSelectionMutation(
		fmt.Sprintf("cluster-transport-rebuild:%s", clusterID),
		func(_ *selectionMutation) error {
			return a.rebuildClusterTransport(clusterID, reason, cause)
		},
	); err != nil {
		a.appLogs.logger.Warn(fmt.Sprintf("Transport rebuild coordination failed for cluster %s: %v", clusterID, err), logsources.KubernetesClient, clusterID, a.clusterNameForID(clusterID))
	}
}

func (a *WorkspaceCoordinator) rebuildClusterTransport(clusterID, reason string, cause error) error {
	state := a.getTransportState(clusterID)
	defer func() {
		state.mu.Lock()
		state.failureCount = 0
		state.windowStart = time.Time{}
		state.rebuildInProgress = false
		state.mu.Unlock()
	}()

	if recorder := a.currentTelemetryRecorder(); recorder != nil {
		recorder.RecordTransportRebuild(fmt.Sprintf("cluster:%s - %s", clusterID, reason))
	}
	a.appLogs.logger.Info(fmt.Sprintf("Starting transport rebuild for cluster %s", clusterID), logsources.KubernetesClient, clusterID, a.clusterNameForID(clusterID))

	if err := a.runClusterOperation(context.Background(), clusterID, func(opCtx context.Context) error {
		if err := opCtx.Err(); err != nil {
			return err
		}
		a.rebuildClusterSubsystem(clusterID)
		return opCtx.Err()
	}); err != nil {
		return err
	}

	if a.appLogs.logger != nil {
		message := fmt.Sprintf("Transport rebuild complete for cluster %s", clusterID)
		if cause != nil {
			message = fmt.Sprintf("%s after %v", message, cause)
		}
		a.appLogs.logger.Info(message, logsources.KubernetesClient, clusterID, a.clusterNameForID(clusterID))
	}
	return nil
}
