package backend

import "time"

func (a *App) SetKubernetesClientRateLimits(qps, burst int) {
	if a != nil {
		a.applyKubernetesClientRateLimits(qps, burst)
	}
}

func (a *App) SetContainerLogsGlobalLimit(limit int) {
	if a == nil {
		return
	}
	if limiter := a.sharedContainerLogsTargetLimiter(); limiter != nil {
		limiter.SetLimit(limit)
	}
}

func (a *App) SetMetricsRefreshInterval(intervalMs int) {
	if a == nil {
		return
	}
	interval := time.Duration(intervalMs) * time.Millisecond
	for _, subsystem := range a.snapshotRefreshSubsystems() {
		setSubsystemMetricsInterval(subsystem, interval)
	}
}
