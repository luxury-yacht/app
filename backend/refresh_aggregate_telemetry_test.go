package backend

import (
	"testing"

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
