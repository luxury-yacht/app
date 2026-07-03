package snapshot

// Serve-time metric join helpers shared by the base table domains (pods, nodes,
// namespace-workloads). Each Build reads the poller's latest usage + metadata once,
// joins usage onto the served row copies (never the stores), stamps the collection
// revision as the snapshot's "metric" source clock, and publishes the poller
// freshness/error state as the payload's Metrics block.

import (
	"strconv"
	"time"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/refresh/metrics"
)

// Both helpers read the provider's Sample — one consistent collection — never
// the individual accessors: usage paired with another collection's metadata
// would stamp a metric revision the joined rows don't contain.
func latestPodMetrics(provider metrics.Provider) (map[string]metrics.PodUsage, metrics.Metadata) {
	if provider == nil {
		return map[string]metrics.PodUsage{}, metrics.Metadata{}
	}
	sample := provider.Sample()
	return podUsageOrEmpty(sample.PodUsage), sample.Metadata
}

func latestNodeMetrics(provider metrics.Provider) (map[string]metrics.NodeUsage, map[string]metrics.PodUsage, metrics.Metadata) {
	if provider == nil {
		return map[string]metrics.NodeUsage{}, map[string]metrics.PodUsage{}, metrics.Metadata{}
	}
	sample := provider.Sample()
	return nodeUsageOrEmpty(sample.NodeUsage), podUsageOrEmpty(sample.PodUsage), sample.Metadata
}

// metricRevisionFromMetadata is the metric source clock: it advances exactly when the
// poller collects a new sample, so the snapshot's 304 validator breaks on a metric
// tick without moving the object Version. An empty revision (no sample yet, or no
// provider) contributes no metric clock at all.
func metricRevisionFromMetadata(metadata metrics.Metadata) string {
	if metadata.CollectedAt.IsZero() {
		return ""
	}
	return strconv.FormatInt(metadata.CollectedAt.UnixNano(), 10)
}

func podMetricsInfoFromMetadata(metadata metrics.Metadata) PodMetricsInfo {
	info := PodMetricsInfo{
		Stale:               true,
		LastError:           metadata.LastError,
		ConsecutiveFailures: metadata.ConsecutiveFailures,
		SuccessCount:        metadata.SuccessCount,
		FailureCount:        metadata.FailureCount,
	}
	if !metadata.CollectedAt.IsZero() {
		info.CollectedAt = metadata.CollectedAt.Unix()
		info.Stale = time.Since(metadata.CollectedAt) > config.MetricsStaleThreshold
	}
	return info
}

func nodeMetricsInfoFromMetadata(metadata metrics.Metadata) NodeMetricsInfo {
	info := NodeMetricsInfo{
		Stale:               true,
		LastError:           metadata.LastError,
		ConsecutiveFailures: metadata.ConsecutiveFailures,
		SuccessCount:        metadata.SuccessCount,
		FailureCount:        metadata.FailureCount,
	}
	if !metadata.CollectedAt.IsZero() {
		info.CollectedAt = metadata.CollectedAt.Unix()
		info.Stale = time.Since(metadata.CollectedAt) > config.MetricsStaleThreshold
	}
	return info
}
