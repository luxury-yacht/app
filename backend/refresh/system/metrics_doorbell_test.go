package system

import (
	"strconv"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/refresh/metrics"
	"github.com/luxury-yacht/app/backend/refresh/resourcestream"
	"github.com/luxury-yacht/app/backend/refresh/snapshot"
	"github.com/stretchr/testify/require"
)

// The metrics collection observer must fan a SourceMetric doorbell (versioned by
// the collection revision, the same CollectedAt-nanos value the snapshot builders
// stamp as SourceVersions["metric"]) to the metric-clock domains' subscribers —
// this is what lets tables refetch on the poller's schedule with no client-side
// polling. A zero CollectedAt (no sample yet) must not broadcast.
func TestMetricsSignalObserverBroadcastsMetricDoorbells(t *testing.T) {
	manager := resourcestream.NewManager(
		nil,
		nil,
		nil,
		nil,
		snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"},
		nil,
		nil,
	)
	podsSelector, err := resourcestream.ParseStreamSelector("c1", "pods", "namespace:prod")
	require.NoError(t, err)
	podsSub, err := manager.SubscribeSelector(podsSelector)
	require.NoError(t, err)
	nodesSelector, err := resourcestream.ParseStreamSelector("c1", "nodes", "cluster")
	require.NoError(t, err)
	nodesSub, err := manager.SubscribeSelector(nodesSelector)
	require.NoError(t, err)
	namespaceMetricsSelector, err := resourcestream.ParseStreamSelector("c1", "namespace-metrics", "cluster")
	require.NoError(t, err)
	namespaceMetricsSub, err := manager.SubscribeSelector(namespaceMetricsSelector)
	require.NoError(t, err)

	observer := metricsSignalObserver(manager)

	collectedAt := time.Unix(1700000000, 42)
	observer(metrics.Metadata{CollectedAt: collectedAt})

	wantVersion := strconv.FormatInt(collectedAt.UnixNano(), 10)
	podsUpdate := requireSystemDoorbellUpdate(t, podsSub)
	require.Equal(t, "pods", podsUpdate.Domain)
	require.Equal(t, "namespace:prod", podsUpdate.Scope)
	require.Equal(t, resourcestream.SourceMetric, podsUpdate.Source)
	require.Equal(t, wantVersion, podsUpdate.Version)

	nodesUpdate := requireSystemDoorbellUpdate(t, nodesSub)
	require.Equal(t, "nodes", nodesUpdate.Domain)
	require.Equal(t, "", nodesUpdate.Scope)
	require.Equal(t, resourcestream.SourceMetric, nodesUpdate.Source)
	require.Equal(t, wantVersion, nodesUpdate.Version)

	namespaceMetricsUpdate := requireSystemDoorbellUpdate(t, namespaceMetricsSub)
	require.Equal(t, "namespace-metrics", namespaceMetricsUpdate.Domain)
	require.Equal(t, "", namespaceMetricsUpdate.Scope)
	require.Equal(t, resourcestream.SourceMetric, namespaceMetricsUpdate.Source)
	require.Equal(t, wantVersion, namespaceMetricsUpdate.Version)

	// No sample yet -> no doorbell.
	observer(metrics.Metadata{})
	select {
	case update := <-podsSub.Updates:
		t.Fatalf("zero CollectedAt must not broadcast, got %+v", update)
	default:
	}

	observer(metrics.Metadata{FailureCount: 1, LastError: "metrics request failed"})
	select {
	case update := <-podsSub.Updates:
		t.Fatalf("failed collection must not broadcast a sample doorbell, got %+v", update)
	default:
	}
}
