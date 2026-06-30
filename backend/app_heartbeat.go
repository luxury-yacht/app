package backend

import (
	"context"
	"time"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/internal/credentialerrors"
	"github.com/luxury-yacht/app/backend/internal/logsources"
)

// healthStatus distinguishes the outcome of a cluster health check.
type healthStatus int

const (
	healthOK                  healthStatus = iota // cluster responded 200 on /readyz
	healthAuthFailure                             // cluster returned 401/403
	healthConnectivityFailure                     // network error, timeout, or other non-auth failure
)

// runHeartbeatIteration iterates all clusters and checks their health independently.
// This is the per-cluster heartbeat that:
// 1. Skips clusters with invalid auth (they need recovery, not heartbeat checks)
// 2. Checks health via the /readyz endpoint for each cluster
// 3. Emits cluster-specific health events (cluster:health:healthy or cluster:health:degraded)
// 4. Reports auth failures to the cluster's auth manager (connectivity failures are ignored by auth)
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

		// Skip health checks while auth is not valid: requests through the
		// cluster's transport are blocked in that state, and the auth
		// manager's recovery loop keeps probing on its own cadence.
		if cc.authManager != nil && !cc.authManager.IsValid() {
			a.logger.Debug("Skipping heartbeat for cluster "+cc.meta.Name+" (auth invalid)", logsources.Heartbeat, clusterID, cc.meta.Name)
			continue
		}

		// Check health and distinguish failure type
		status := a.checkClusterHealth(cc)

		// Build event data with cluster info
		eventData := map[string]any{
			"clusterId":   clusterID,
			"clusterName": cc.meta.Name,
		}

		switch status {
		case healthOK:
			a.emitEvent("cluster:health:healthy", eventData)

			a.logger.Debug("Heartbeat healthy for cluster "+cc.meta.Name, logsources.Heartbeat, clusterID, cc.meta.Name)

		case healthAuthFailure:
			eventData["reason"] = "auth"
			a.emitEvent("cluster:health:degraded", eventData)

			a.logger.Warn("Heartbeat auth failure for cluster "+cc.meta.Name, logsources.Heartbeat, clusterID, cc.meta.Name)

			// Only report to auth manager for genuine auth failures.
			if cc.authManager != nil {
				cc.authManager.ReportFailure("heartbeat auth failure")
			}

		case healthConnectivityFailure:
			eventData["reason"] = "connectivity"
			a.emitEvent("cluster:health:degraded", eventData)

			a.logger.Warn("Heartbeat connectivity failure for cluster "+cc.meta.Name, logsources.Heartbeat, clusterID, cc.meta.Name)
			// Do NOT report to auth manager — this is a network issue, not an auth issue.
		}
	}
}

// checkClusterHealth checks if a cluster is healthy by calling the /readyz endpoint.
// Returns healthOK, healthAuthFailure, or healthConnectivityFailure.
func (a *App) checkClusterHealth(cc *clusterClients) healthStatus {
	if cc == nil || cc.client == nil {
		return healthConnectivityFailure
	}

	// Guard the Discovery→RESTClient chain; either can be nil during client init.
	disco := cc.client.Discovery()
	if disco == nil {
		return healthConnectivityFailure
	}
	restClient := disco.RESTClient()
	if restClient == nil {
		return healthConnectivityFailure
	}

	// Create a context with timeout for the health check
	ctx, cancel := context.WithTimeout(a.CtxOrBackground(), config.ClusterHealthHeartbeatTimeout)
	defer cancel()

	// Call /readyz endpoint to check cluster health
	_, err := restClient.Get().AbsPath("/readyz").DoRaw(ctx)
	if err == nil {
		return healthOK
	}

	// Distinguish auth errors from connectivity errors. A rejected credential
	// (HTTP 401/403) or a failed/missing exec credential plugin is an auth
	// failure; everything else (network error, timeout, DNS) is connectivity.
	// Exec-plugin failures never produce an HTTP response — the request fails
	// before it is sent — so they are detected by the shared classifier too.
	if credentialerrors.Classify(err, credentialerrors.Context{}).IsAuth() {
		return healthAuthFailure
	}
	return healthConnectivityFailure
}

// startHeartbeatLoop runs runHeartbeatIteration on a periodic schedule.
// It fires once immediately so the frontend gets cluster health on startup,
// then repeats every config.ClusterHealthHeartbeatInterval.
// The loop exits when ctx is cancelled (via a.refreshCancel).
func (a *App) startHeartbeatLoop(ctx context.Context) {
	// Run immediately so the frontend has status before the first tick.
	a.runHeartbeatIteration()

	ticker := time.NewTicker(config.ClusterHealthHeartbeatInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			a.runHeartbeatIteration()
		}
	}
}
