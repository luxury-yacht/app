package backend

import (
	"context"
	"time"
)

const (
	heartbeatInterval = 15 * time.Second
	heartbeatTimeout  = 5 * time.Second
)

// runHeartbeatIteration iterates all clusters and checks their health independently.
// This is the per-cluster heartbeat that:
// 1. Skips clusters with invalid auth (they need recovery, not heartbeat checks)
// 2. Checks health via the /healthz endpoint for each cluster
// 3. Emits cluster-specific health events (cluster:health:healthy or cluster:health:degraded)
// 4. Reports failures to the cluster's auth manager (NOT global transport failure)
//
// IMPORTANT: This function does NOT call:
// - recordTransportFailure() - this triggers global recovery
// - updateConnectionStatus() - this updates global state
func (a *App) runHeartbeatIteration() {
	if a == nil {
		return
	}

	// Take a snapshot of cluster clients under lock to avoid holding the lock during health checks
	a.clusterClientsMu.Lock()
	clients := make(map[string]*clusterClients, len(a.clusterClients))
	for k, v := range a.clusterClients {
		clients[k] = v
	}
	a.clusterClientsMu.Unlock()

	for clusterID, cc := range clients {
		// Skip if cluster has no clients
		if cc == nil {
			continue
		}

		// Skip if auth is already invalid - these clusters need auth recovery, not heartbeat checks
		if cc.authManager != nil && !cc.authManager.IsValid() {
			if a.logger != nil {
				a.logger.Debug("Skipping heartbeat for cluster "+cc.meta.Name+" (auth invalid)", "Heartbeat")
			}
			continue
		}

		// Check health
		healthy := a.checkClusterHealth(cc)

		// Build event data with cluster info
		eventData := map[string]any{
			"clusterId":   clusterID,
			"clusterName": cc.meta.Name,
		}

		if healthy {
			// Emit cluster-specific healthy event using the eventEmitter
			// (set to runtime.EventsEmit in production, mockable in tests)
			a.emitEvent("cluster:health:healthy", eventData)

			if a.logger != nil {
				a.logger.Debug("Heartbeat healthy for cluster "+cc.meta.Name, "Heartbeat")
			}
		} else {
			// Emit cluster-specific degraded event using the eventEmitter
			// (set to runtime.EventsEmit in production, mockable in tests)
			a.emitEvent("cluster:health:degraded", eventData)

			if a.logger != nil {
				a.logger.Warn("Heartbeat degraded for cluster "+cc.meta.Name, "Heartbeat")
			}

			// Report to cluster's auth manager for per-cluster recovery
			// IMPORTANT: Do NOT call recordTransportFailure() or updateConnectionStatus()
			// Those methods update global state and trigger global recovery.
			// Instead, report to the cluster's auth manager for per-cluster handling.
			if cc.authManager != nil {
				cc.authManager.ReportFailure("heartbeat check failed")
			}
		}
	}
}

// checkClusterHealth checks if a cluster is healthy by calling the /healthz endpoint.
// Returns true if the cluster is healthy, false otherwise.
func (a *App) checkClusterHealth(cc *clusterClients) bool {
	if cc == nil || cc.client == nil {
		return false
	}

	// Create a context with timeout for the health check
	ctx, cancel := context.WithTimeout(a.CtxOrBackground(), heartbeatTimeout)
	defer cancel()

	// Call /healthz endpoint to check cluster health
	_, err := cc.client.Discovery().RESTClient().Get().AbsPath("/healthz").DoRaw(ctx)
	return err == nil
}
