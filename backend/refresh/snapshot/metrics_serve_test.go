package snapshot

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/refresh/metrics"
)

// racyMetricsProvider simulates a poller collection landing between provider
// reads: every accessor call advances the collection tick after answering, so
// a consumer that reads usage and metadata in separate calls observes usage
// from one collection paired with the NEXT collection's metadata — whose
// revision the snapshot builders stamp as the metric source clock.
type racyMetricsProvider struct {
	tick int64
}

func newRacyMetricsProvider() *racyMetricsProvider {
	return &racyMetricsProvider{tick: 100}
}

func (p *racyMetricsProvider) LatestNodeUsage() map[string]metrics.NodeUsage {
	defer func() { p.tick++ }()
	return map[string]metrics.NodeUsage{"node-1": {CPUUsageMilli: p.tick}}
}

func (p *racyMetricsProvider) LatestPodUsage() map[string]metrics.PodUsage {
	defer func() { p.tick++ }()
	return map[string]metrics.PodUsage{"team-a/pod-1": {CPUUsageMilli: p.tick}}
}

func (p *racyMetricsProvider) Metadata() metrics.Metadata {
	defer func() { p.tick++ }()
	return metrics.Metadata{CollectedAt: time.Unix(p.tick, 0)}
}

// Sample returns one consistent collection (usage and metadata from the same
// tick) and then advances — the atomicity contract the serve path relies on.
func (p *racyMetricsProvider) Sample() metrics.Sample {
	defer func() { p.tick++ }()
	return metrics.Sample{
		NodeUsage: map[string]metrics.NodeUsage{"node-1": {CPUUsageMilli: p.tick}},
		PodUsage:  map[string]metrics.PodUsage{"team-a/pod-1": {CPUUsageMilli: p.tick}},
		Metadata:  metrics.Metadata{CollectedAt: time.Unix(p.tick, 0)},
	}
}

func TestLatestPodMetricsReadsUsageAndRevisionFromOneCollection(t *testing.T) {
	provider := newRacyMetricsProvider()
	usage, metadata := latestPodMetrics(provider)
	require.Equal(t, metadata.CollectedAt.Unix(), usage["team-a/pod-1"].CPUUsageMilli,
		"pod usage and metadata must come from the same collection: the metadata revision is stamped as the snapshot's metric source clock for the usage joined into the rows")
}

// The payload must carry the staleness threshold so the frontend can flip the
// stale banner client-side: the poller rings no doorbell on failure, so on a
// quiet cluster nothing ever refetches to refresh a server-computed Stale flag.
func TestMetricsInfoCarriesStaleThreshold(t *testing.T) {
	metadata := metrics.Metadata{CollectedAt: time.Unix(100, 0)}
	wantSeconds := int64(config.MetricsStaleThreshold / time.Second)
	require.Equal(t, wantSeconds, podMetricsInfoFromMetadata(metadata).StaleAfterSeconds)
	require.Equal(t, wantSeconds, nodeMetricsInfoFromMetadata(metadata).StaleAfterSeconds)
}

func TestLatestNodeMetricsReadsUsageAndRevisionFromOneCollection(t *testing.T) {
	provider := newRacyMetricsProvider()
	nodeUsage, podUsage, metadata := latestNodeMetrics(provider)
	require.Equal(t, metadata.CollectedAt.Unix(), nodeUsage["node-1"].CPUUsageMilli,
		"node usage and metadata must come from the same collection")
	require.Equal(t, metadata.CollectedAt.Unix(), podUsage["team-a/pod-1"].CPUUsageMilli,
		"the per-node pod usage join must come from the same collection as the metadata")
}
