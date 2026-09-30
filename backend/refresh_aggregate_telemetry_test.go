package backend

import (
	"errors"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/refresh/system"
	"github.com/luxury-yacht/app/backend/refresh/telemetry"
	"github.com/stretchr/testify/require"
)

// TestAggregateTelemetryMergesPerClusterStreams proves the diagnostics telemetry
// is multi-cluster aware: it concatenates every active cluster's stream
// telemetry (cluster-tagged) instead of reporting a single picked cluster, and
// Update re-scopes it when the active cluster set changes.
func TestAggregateTelemetryMergesPerClusterStreams(t *testing.T) {
	rec1 := telemetry.NewRecorder()
	rec1.SetClusterMeta("cluster-1", "One")
	rec1.RecordStreamDelivery(telemetry.StreamResources, 5, 0)

	rec2 := telemetry.NewRecorder()
	rec2.SetClusterMeta("cluster-2", "Two")
	rec2.RecordStreamDelivery(telemetry.StreamResources, 7, 0)

	subsystems := map[string]*system.Subsystem{
		"cluster-1": {Telemetry: rec1},
		"cluster-2": {Telemetry: rec2},
	}
	agg := newAggregateTelemetry([]string{"cluster-1", "cluster-2"}, subsystems)

	streams := agg.SnapshotSummary().Streams
	require.Len(t, streams, 2)
	byCluster := map[string]telemetry.StreamStatus{}
	for _, s := range streams {
		byCluster[s.ClusterID] = s
	}
	require.Equal(t, uint64(5), byCluster["cluster-1"].TotalMessages)
	require.Equal(t, uint64(7), byCluster["cluster-2"].TotalMessages)

	// Closing cluster-1 must drop its telemetry — no carry-over under the active cluster.
	agg.Update([]string{"cluster-2"}, map[string]*system.Subsystem{"cluster-2": {Telemetry: rec2}})
	streams = agg.SnapshotSummary().Streams
	require.Len(t, streams, 1)
	require.Equal(t, "cluster-2", streams[0].ClusterID)
}

// TestAggregateTelemetryEmptyReturnsNonNilSlices guards the wire contract: the
// frontend expects arrays, so an empty aggregate must serialize streams/snapshots
// as [] not null.
func TestAggregateTelemetryEmptyReturnsNonNilSlices(t *testing.T) {
	agg := newAggregateTelemetry(nil, map[string]*system.Subsystem{})
	summary := agg.SnapshotSummary()
	require.NotNil(t, summary.Streams)
	require.NotNil(t, summary.Snapshots)
}

// Each cluster's metrics polling status is reported, tagged with its cluster, so
// the diagnostics Metrics card can show the active cluster's instead of
// whichever cluster is first.
func TestAggregateTelemetryReportsEachClustersMetrics(t *testing.T) {
	rec1 := telemetry.NewRecorder()
	rec1.SetClusterMeta("cluster-1", "One")
	rec1.RecordMetrics(20*time.Millisecond, time.Now(), nil, 0, true)

	rec2 := telemetry.NewRecorder()
	rec2.SetClusterMeta("cluster-2", "Two")
	rec2.RecordMetrics(30*time.Millisecond, time.Now(), errors.New("metrics API unavailable"), 3, false)

	agg := newAggregateTelemetry([]string{"cluster-1", "cluster-2"}, map[string]*system.Subsystem{
		"cluster-1": {Telemetry: rec1},
		"cluster-2": {Telemetry: rec2},
	})

	byCluster := map[string]telemetry.ClusterMetricsStatus{}
	for _, status := range agg.SnapshotSummary().ClusterMetrics {
		byCluster[status.ClusterID] = status
	}
	require.Len(t, byCluster, 2)
	require.Equal(t, "One", byCluster["cluster-1"].ClusterName)
	require.Equal(t, uint64(1), byCluster["cluster-1"].Metrics.SuccessCount)
	require.Equal(t, 3, byCluster["cluster-2"].Metrics.ConsecutiveFailures)
	require.Equal(t, "metrics API unavailable", byCluster["cluster-2"].Metrics.LastError)
}
