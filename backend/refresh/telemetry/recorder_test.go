package telemetry

import (
	"errors"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/objectcatalog"
	"github.com/stretchr/testify/require"
)

func TestRecordCatalogTracksStatus(t *testing.T) {
	rec := NewRecorder()

	rec.RecordCatalog(true, 5, 2, 1500*time.Millisecond, nil)
	summary := rec.SnapshotSummary()
	require.NotNil(t, summary.Catalog)
	require.Equal(t, "success", summary.Catalog.Status)
	require.Equal(t, 0, summary.Catalog.ConsecutiveFailures)
	require.False(t, summary.Catalog.Stale)
	require.Equal(t, 0, summary.Catalog.FailedResourceCount)
	require.NotZero(t, summary.Catalog.LastSuccess)

	partial := &objectcatalog.PartialSyncError{FailedDescriptors: []string{"apps/v1/deployments"}, Err: errors.New("boom")}
	rec.RecordCatalog(true, 5, 2, 2500*time.Millisecond, partial)
	summary = rec.SnapshotSummary()
	require.Equal(t, "degraded", summary.Catalog.Status)
	require.Equal(t, 1, summary.Catalog.ConsecutiveFailures)
	require.True(t, summary.Catalog.Stale)
	require.Equal(t, 1, summary.Catalog.FailedResourceCount)
	require.Equal(t, partial.Error(), summary.Catalog.LastError)

	rec.RecordCatalog(true, 6, 3, 500*time.Millisecond, nil)
	summary = rec.SnapshotSummary()
	require.Equal(t, "success", summary.Catalog.Status)
	require.Equal(t, 0, summary.Catalog.ConsecutiveFailures)
	require.False(t, summary.Catalog.Stale)
	require.Equal(t, 0, summary.Catalog.FailedResourceCount)
	require.Equal(t, "", summary.Catalog.LastError)
}

func TestRecordCatalogDisabledResetsState(t *testing.T) {
	rec := NewRecorder()

	rec.RecordCatalog(true, 1, 1, time.Second, errors.New("ouch"))
	rec.RecordCatalog(false, 0, 0, 0, nil)

	summary := rec.SnapshotSummary()
	require.NotNil(t, summary.Catalog)
	require.False(t, summary.Catalog.Enabled)
	require.Equal(t, "disabled", summary.Catalog.Status)
	require.Equal(t, 0, summary.Catalog.ConsecutiveFailures)
	require.False(t, summary.Catalog.Stale)
	require.Equal(t, 0, summary.Catalog.FailedResourceCount)
	require.Equal(t, "", summary.Catalog.LastError)
}

func TestConnectionStatsRecording(t *testing.T) {
	rec := NewRecorder()

	retryErr := errors.New("dial tcp: connection refused")
	rec.RecordRetryAttempt(retryErr)
	rec.RecordRetrySuccess()
	rec.RecordRetryAttempt(nil)
	exhaustedErr := errors.New("context deadline exceeded")
	rec.RecordRetryExhausted(exhaustedErr)
	rec.RecordTransportRebuild("transport failure")
	rec.RecordConnectionState("retrying", "Retrying", "Retrying request", int64(time.Second/time.Millisecond), time.Now().UnixMilli())

	summary := rec.SnapshotSummary()
	require.Equal(t, uint64(2), summary.Connection.RetryAttempts)
	require.Equal(t, uint64(1), summary.Connection.RetrySuccesses)
	require.Equal(t, uint64(1), summary.Connection.RetryExhausted)
	require.Equal(t, uint64(1), summary.Connection.TransportRebuilds)
	require.Equal(t, exhaustedErr.Error(), summary.Connection.LastRetryError)
	require.Equal(t, "transport failure", summary.Connection.LastTransportReason)
	require.Equal(t, "retrying", summary.Connection.State)
	require.Equal(t, "Retrying", summary.Connection.StateLabel)
	require.Equal(t, "Retrying request", summary.Connection.StateMessage)
	require.Equal(t, int64(time.Second/time.Millisecond), summary.Connection.NextRetryMs)
	require.NotZero(t, summary.Connection.LastUpdated)
}

func TestRecordSnapshotAggregatesWarningsAndAverages(t *testing.T) {
	rec := NewRecorder()

	rec.RecordSnapshot("domains", "scopeA", "cluster-1", "cluster-one", 100*time.Millisecond, errors.New("boom"), false, 10, []string{"catalog fallback on namespaces", "hydration failed"}, 0, 2, 5, false, 12)
	rec.RecordSnapshot("domains", "scopeB", "cluster-1", "cluster-one", 200*time.Millisecond, nil, true, 5, nil, 1, 2, 3, true, 0)

	summary := rec.SnapshotSummary()
	require.Len(t, summary.Snapshots, 1)

	s := summary.Snapshots[0]
	require.Equal(t, "domains", s.Domain)
	require.Equal(t, "scopeB", s.Scope)
	require.Equal(t, "success", s.LastStatus)
	require.Equal(t, "", s.LastError)
	require.Equal(t, int64(150), s.AverageDurationMs)
	require.Equal(t, 2, s.TotalBatches)
	require.Equal(t, 1, s.LastBatchIndex)
	require.Equal(t, 3, s.LastBatchSize)
	require.True(t, s.IsFinalBatch)
	require.Equal(t, int64(12), s.TimeToFirstBatchMs)
	require.True(t, s.Truncated)
	require.Equal(t, 5, s.TotalItems)
	require.Equal(t, uint64(1), s.FailureCount)
	require.Equal(t, uint64(1), s.SuccessCount)
	require.Equal(t, uint64(1), s.FallbackCount)
	require.Equal(t, uint64(1), s.HydrationCount)
	require.Equal(t, "", s.LastWarning) // cleared when last call had no warnings
}

func TestRecordMetrics(t *testing.T) {
	rec := NewRecorder()

	ts := time.Now().Add(-time.Minute)
	rec.RecordMetrics(250*time.Millisecond, ts, errors.New("oops"), 2, false)
	rec.RecordMetrics(120*time.Millisecond, ts, nil, 0, true)

	summary := rec.SnapshotSummary()
	require.Equal(t, int64(120), summary.Metrics.LastDurationMs)
	require.Equal(t, ts.UnixMilli(), summary.Metrics.LastCollected)
	require.Equal(t, 0, summary.Metrics.ConsecutiveFailures)
	require.Equal(t, uint64(1), summary.Metrics.SuccessCount)
	require.Equal(t, uint64(1), summary.Metrics.FailureCount)
	require.Equal(t, "", summary.Metrics.LastError)
}

func TestStreamTelemetry(t *testing.T) {
	rec := NewRecorder()

	rec.RecordStreamConnect(StreamLogs)
	rec.RecordStreamDelivery(StreamLogs, 3, 0)
	rec.RecordStreamDelivery(StreamLogs, 0, 2)
	rec.RecordStreamError(StreamLogs, errors.New("pipe closed"))
	rec.RecordStreamDisconnect(StreamLogs)

	streams := rec.SnapshotSummary().Streams
	require.Len(t, streams, 1)
	s := streams[0]
	require.Equal(t, StreamLogs, s.Name)
	require.Equal(t, 0, s.ActiveSessions)
	require.Equal(t, uint64(3), s.TotalMessages)
	require.Equal(t, uint64(2), s.DroppedMessages)
	require.Equal(t, uint64(2), s.ErrorCount) // one from dropped, one from explicit error
	require.Equal(t, "pipe closed", s.LastError)

	rec.RecordStreamDelivery(StreamLogs, 1, 0)
	s = rec.SnapshotSummary().Streams[0]
	require.Equal(t, "pipe closed", s.LastError) // last error persists until overwritten
}
