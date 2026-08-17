package backend

import (
	"fmt"
	"time"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/internal/logsources"
)

// getTransportState returns the transport failure state for a given cluster,
// creating a new one if it doesn't exist. This method is thread-safe and
// lazily initializes the transportStates map if needed.
func (m *ClusterRuntimeManager) getTransportState(clusterID string) *transportFailureState {
	m.transportStatesMu.Lock()
	defer m.transportStatesMu.Unlock()
	if m.transportStates == nil {
		m.transportStates = make(map[string]*transportFailureState)
	}
	if m.transportStates[clusterID] == nil {
		m.transportStates[clusterID] = &transportFailureState{}
	}
	return m.transportStates[clusterID]
}

// recordClusterTransportFailure records a transport failure for a specific cluster.
// If the failure threshold is reached within the time window, it triggers a
// per-cluster rebuild. This isolates failures so one cluster's problems don't
// affect others.
func (m *ClusterRuntimeManager) recordClusterTransportFailure(clusterID, reason string, err error) {
	if m == nil {
		return
	}
	state := m.getTransportState(clusterID)
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
		m.logger.Warn(fmt.Sprintf("Transport connectivity degraded for cluster %s (%s); rebuilding", clusterID, reason), logsources.KubernetesClient, clusterID, m.clusterNameForID(clusterID))
		cause := ""
		if err != nil {
			cause = err.Error()
		}
		m.intents.Publish(ClusterRuntimeIntent{
			Kind:       ClusterRuntimeIntentTransportRebuild,
			ClusterID:  clusterID,
			Generation: m.intentGeneration.Add(1),
			Cause:      reason + ": " + cause,
		})
	}
}

// recordClusterTransportSuccess records a successful transport operation for
// a specific cluster, resetting its failure count.
func (m *ClusterRuntimeManager) recordClusterTransportSuccess(clusterID string) {
	if m == nil {
		return
	}
	state := m.getTransportState(clusterID)
	state.mu.Lock()
	defer state.mu.Unlock()
	state.failureCount = 0
}
