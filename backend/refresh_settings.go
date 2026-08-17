package backend

import "time"

func (r *RefreshCoordinator) SetContainerLogsGlobalLimit(limit int) {
	if r == nil {
		return
	}
	if limiter := r.sharedContainerLogsTargetLimiter(); limiter != nil {
		limiter.SetLimit(limit)
	}
}

func (r *RefreshCoordinator) SetMetricsRefreshInterval(intervalMs int) {
	if r == nil {
		return
	}
	interval := time.Duration(intervalMs) * time.Millisecond
	r.metricsIntervalMu.Lock()
	r.metricsInterval = interval
	r.metricsIntervalMu.Unlock()
	for _, subsystem := range r.snapshotRefreshSubsystems() {
		setSubsystemMetricsInterval(subsystem, interval)
	}
}
