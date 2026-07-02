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

func latestPodMetrics(provider metrics.Provider) (map[string]metrics.PodUsage, metrics.Metadata) {
	if provider == nil {
		return map[string]metrics.PodUsage{}, metrics.Metadata{}
	}
	return podUsageOrEmpty(provider.LatestPodUsage()), provider.Metadata()
}

func latestNodeMetrics(provider metrics.Provider) (map[string]metrics.NodeUsage, map[string]metrics.PodUsage, metrics.Metadata) {
	if provider == nil {
		return map[string]metrics.NodeUsage{}, map[string]metrics.PodUsage{}, metrics.Metadata{}
	}
	return nodeUsageOrEmpty(provider.LatestNodeUsage()), podUsageOrEmpty(provider.LatestPodUsage()), provider.Metadata()
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
