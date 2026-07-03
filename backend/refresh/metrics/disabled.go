package metrics

import (
	"context"
	"time"

	"github.com/luxury-yacht/app/backend/refresh/telemetry"
)

// DisabledPoller is a no-op implementation used when metrics access is unavailable.
type DisabledPoller struct {
	recorder *telemetry.Recorder
	reason   string
}

// NewDisabledPoller returns a provider that never collects metrics.
func NewDisabledPoller(recorder *telemetry.Recorder, reason string) *DisabledPoller {
	return &DisabledPoller{recorder: recorder, reason: reason}
}

// Start satisfies the refresh.MetricsPoller interface.
func (p *DisabledPoller) Start(ctx context.Context) error {
	return nil
}

// Stop satisfies the refresh.MetricsPoller interface.
func (p *DisabledPoller) Stop(ctx context.Context) error {
	return nil
}

// LatestNodeUsage returns an empty usage map.
func (p *DisabledPoller) LatestNodeUsage() map[string]NodeUsage {
	return map[string]NodeUsage{}
}

// LatestPodUsage returns an empty pod usage map.
func (p *DisabledPoller) LatestPodUsage() map[string]PodUsage {
	return map[string]PodUsage{}
}

// Sample returns empty usage with the disabled metadata; trivially consistent.
func (p *DisabledPoller) Sample() Sample {
	return Sample{
		NodeUsage: map[string]NodeUsage{},
		PodUsage:  map[string]PodUsage{},
		Metadata:  p.Metadata(),
	}
}

// Metadata returns a minimal metadata payload indicating metrics are disabled.
func (p *DisabledPoller) Metadata() Metadata {
	message := p.reason
	if message == "" {
		message = "metrics polling disabled"
	}
	return Metadata{
		CollectedAt:         time.Time{},
		ConsecutiveFailures: 0,
		LastError:           message,
		SuccessCount:        0,
		FailureCount:        0,
	}
}
