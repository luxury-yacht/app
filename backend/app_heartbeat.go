package backend

import (
	"context"
	"time"
)

const (
	heartbeatInterval = 15 * time.Second
	heartbeatTimeout  = 5 * time.Second
)

func (a *App) startHeartbeatLoop() {
	if a == nil {
		return
	}
	go func() {
		ticker := time.NewTicker(heartbeatInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				a.runHeartbeat()
			case <-a.CtxOrBackground().Done():
				return
			}
		}
	}()
}

func (a *App) runHeartbeat() {
	if a == nil || a.client == nil {
		return
	}

	a.transportMu.Lock()
	rebuilding := a.transportRebuildInProgress
	a.transportMu.Unlock()
	if rebuilding {
		return
	}

	ctx, cancel := context.WithTimeout(a.CtxOrBackground(), heartbeatTimeout)
	defer cancel()

	_, err := executeWithRetry(ctx, a, "heartbeat", "cluster", func() (struct{}, error) {
		rest := a.client.Discovery().RESTClient().Get().AbsPath("/version").Timeout(heartbeatTimeout)
		req := rest.Do(ctx)
		return struct{}{}, req.Error()
	})
	if err != nil {
		if a.logger != nil {
			a.logger.Warn("Heartbeat failed: "+err.Error(), "Heartbeat")
		}
		a.updateConnectionStatus(ConnectionStateOffline, "Heartbeat failed", 0)
		return
	}
	if a.logger != nil {
		a.logger.Debug("Heartbeat succeeded", "Heartbeat")
	}
}
