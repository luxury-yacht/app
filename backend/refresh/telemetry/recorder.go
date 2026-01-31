package telemetry

import (
	"errors"
	"strings"
	"sync"
	"time"

	"github.com/luxury-yacht/app/backend/objectcatalog"
)

// SnapshotStatus captures the latest refresh outcome for a domain.
type SnapshotStatus struct {
	Domain             string   `json:"domain"`
	Scope              string   `json:"scope,omitempty"`
	ClusterID          string   `json:"clusterId,omitempty"`
	ClusterName        string   `json:"clusterName,omitempty"`
	LastStatus         string   `json:"lastStatus"`
	LastError          string   `json:"lastError,omitempty"`
	LastWarning        string   `json:"lastWarning,omitempty"`
	LastDurationMs     int64    `json:"lastDurationMs"`
	LastUpdated        int64    `json:"lastUpdated"`
	SuccessCount       uint64   `json:"successCount"`
	FailureCount       uint64   `json:"failureCount"`
	TotalDurationMs    int64    `json:"totalDurationMs,omitempty"`
	AverageDurationMs  int64    `json:"averageDurationMs,omitempty"`
	Truncated          bool     `json:"truncated,omitempty"`
	TotalItems         int      `json:"totalItems,omitempty"`
	Warnings           []string `json:"warnings,omitempty"`
	FallbackCount      uint64   `json:"fallbackCount,omitempty"`
	HydrationCount     uint64   `json:"hydrationCount,omitempty"`
	LastBatchIndex     int      `json:"lastBatchIndex,omitempty"`
	TotalBatches       int      `json:"totalBatches,omitempty"`
	LastBatchSize      int      `json:"lastBatchSize,omitempty"`
	IsFinalBatch       bool     `json:"isFinalBatch,omitempty"`
	TimeToFirstBatchMs int64    `json:"timeToFirstBatchMs,omitempty"`
}

// MetricsStatus captures metrics poller health.
type MetricsStatus struct {
	LastCollected       int64  `json:"lastCollected"`
	LastDurationMs      int64  `json:"lastDurationMs"`
	ConsecutiveFailures int    `json:"consecutiveFailures"`
	LastError           string `json:"lastError,omitempty"`
	SuccessCount        uint64 `json:"successCount"`
	FailureCount        uint64 `json:"failureCount"`
	Active              bool   `json:"active"`
}

// Summary aggregates the telemetry story for diagnostics.
type Summary struct {
	Snapshots  []SnapshotStatus `json:"snapshots"`
	Metrics    MetricsStatus    `json:"metrics"`
	Streams    []StreamStatus   `json:"streams"`
	Catalog    *CatalogStatus   `json:"catalog,omitempty"`
	Connection ConnectionStats  `json:"connection"`
}

// CatalogStatus captures telemetry for the object catalog service.
type CatalogStatus struct {
	Enabled             bool   `json:"enabled"`
	Status              string `json:"status,omitempty"`
	ClusterID           string `json:"clusterId,omitempty"`
	ClusterName         string `json:"clusterName,omitempty"`
	LastSyncMs          int64  `json:"lastSyncMs"`
	LastError           string `json:"lastError,omitempty"`
	ItemCount           int    `json:"itemCount"`
	ResourceCount       int    `json:"resourceCount"`
	LastUpdated         int64  `json:"lastUpdated"`
	LastSuccess         int64  `json:"lastSuccess,omitempty"`
	ConsecutiveFailures int    `json:"consecutiveFailures,omitempty"`
	Stale               bool   `json:"stale,omitempty"`
	FailedResourceCount int    `json:"failedResourceCount,omitempty"`
}

// ConnectionStats summarises backend retry/rebuild activity.
type ConnectionStats struct {
	RetryAttempts       uint64 `json:"retryAttempts"`
	RetrySuccesses      uint64 `json:"retrySuccesses"`
	RetryExhausted      uint64 `json:"retryExhausted"`
	TransportRebuilds   uint64 `json:"transportRebuilds"`
	LastTransportReason string `json:"lastTransportReason,omitempty"`
	LastRetryError      string `json:"lastRetryError,omitempty"`
	State               string `json:"state,omitempty"`
	StateLabel          string `json:"stateLabel,omitempty"`
	StateMessage        string `json:"stateMessage,omitempty"`
	NextRetryMs         int64  `json:"nextRetryMs,omitempty"`
	LastUpdated         int64  `json:"lastUpdated,omitempty"`
}

// Recorder collects refresh and metrics telemetry in-memory.
type Recorder struct {
	mu          sync.RWMutex
	snapshots   map[string]*SnapshotStatus
	metrics     MetricsStatus
	streams     map[string]*StreamStatus
	catalog     CatalogStatus
	connection  ConnectionStats
	clusterID   string
	clusterName string
}

// NewRecorder returns an empty telemetry recorder.
func NewRecorder() *Recorder {
	return &Recorder{
		snapshots: make(map[string]*SnapshotStatus),
		streams:   make(map[string]*StreamStatus),
	}
}

// SetClusterMeta sets the cluster identifiers for diagnostics payloads.
func (r *Recorder) SetClusterMeta(clusterID, clusterName string) {
	if r == nil {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.clusterID = clusterID
	r.clusterName = clusterName
	r.catalog.ClusterID = clusterID
	r.catalog.ClusterName = clusterName
}

// RecordCatalog logs catalog ingestion telemetry.
func (r *Recorder) RecordCatalog(enabled bool, itemCount, resourceCount int, duration time.Duration, err error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	r.catalog.Enabled = enabled
	r.catalog.ClusterID = r.clusterID
	r.catalog.ClusterName = r.clusterName
	r.catalog.ItemCount = itemCount
	r.catalog.ResourceCount = resourceCount
	r.catalog.LastSyncMs = duration.Milliseconds()
	r.catalog.LastUpdated = time.Now().UnixMilli()
	if !enabled {
		r.catalog.Status = "disabled"
		r.catalog.LastError = ""
		r.catalog.ConsecutiveFailures = 0
		r.catalog.Stale = false
		r.catalog.FailedResourceCount = 0
		return
	}

	if err != nil {
		r.catalog.LastError = err.Error()
		r.catalog.ConsecutiveFailures++
		r.catalog.Status = "error"
		r.catalog.Stale = true
		r.catalog.FailedResourceCount = 0
		if partial := new(objectcatalog.PartialSyncError); errors.As(err, &partial) {
			r.catalog.Status = "degraded"
			r.catalog.FailedResourceCount = partial.FailedCount()
		}
	} else {
		r.catalog.LastError = ""
		r.catalog.Status = "success"
		r.catalog.ConsecutiveFailures = 0
		r.catalog.Stale = false
		r.catalog.FailedResourceCount = 0
		r.catalog.LastSuccess = time.Now().UnixMilli()
	}
}

// RecordSnapshot logs a snapshot outcome. The clusterID and clusterName parameters
// identify the cluster that produced this snapshot, allowing accurate attribution
// even when the recorder is shared across clusters (e.g., in aggregate handlers).
func (r *Recorder) RecordSnapshot(
	domain, scope string,
	clusterID, clusterName string,
	duration time.Duration,
	err error,
	truncated bool,
	totalItems int,
	warnings []string,
	batchIndex int,
	totalBatches int,
	batchSize int,
	isFinal bool,
	timeToFirstBatchMs int64,
) {
	if domain == "" {
		return
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	entry, ok := r.snapshots[domain]
	if !ok {
		entry = &SnapshotStatus{Domain: domain}
		r.snapshots[domain] = entry
	}

	entry.Scope = scope
	// Use the provided cluster identifiers instead of instance fields to ensure
	// correct attribution when the recorder is shared across clusters.
	entry.ClusterID = clusterID
	entry.ClusterName = clusterName
	entry.LastDurationMs = duration.Milliseconds()
	entry.LastUpdated = time.Now().UnixMilli()
	entry.Truncated = truncated
	entry.TotalItems = totalItems
	entry.LastBatchIndex = batchIndex
	entry.TotalBatches = totalBatches
	entry.LastBatchSize = batchSize
	entry.IsFinalBatch = isFinal
	if batchIndex == 0 && timeToFirstBatchMs > 0 {
		entry.TimeToFirstBatchMs = timeToFirstBatchMs
	}
	if len(warnings) > 0 {
		copyWarnings := make([]string, 0, len(warnings))
		for _, warning := range warnings {
			if warning == "" {
				continue
			}
			copyWarnings = append(copyWarnings, warning)
		}
		entry.Warnings = copyWarnings
		entry.LastWarning = strings.Join(copyWarnings, "; ")
		if containsCatalogFallback(copyWarnings) {
			entry.FallbackCount++
		}
		if containsHydrationIssue(copyWarnings) {
			entry.HydrationCount++
		}
	} else {
		entry.Warnings = nil
		entry.LastWarning = ""
	}
	if err != nil {
		entry.LastStatus = "error"
		entry.LastError = err.Error()
		entry.FailureCount++
	} else {
		entry.LastStatus = "success"
		entry.LastError = ""
		entry.SuccessCount++
	}

	entry.TotalDurationMs += entry.LastDurationMs
	if calls := entry.SuccessCount + entry.FailureCount; calls > 0 {
		entry.AverageDurationMs = entry.TotalDurationMs / int64(calls)
	}
}

func containsCatalogFallback(warnings []string) bool {
	for _, warning := range warnings {
		if strings.Contains(strings.ToLower(warning), "catalog fallback") {
			return true
		}
	}
	return false
}

func containsHydrationIssue(warnings []string) bool {
	for _, warning := range warnings {
		if strings.Contains(strings.ToLower(warning), "hydration") {
			return true
		}
	}
	return false
}

// RecordMetrics logs a metrics poller outcome.
func (r *Recorder) RecordMetrics(duration time.Duration, collectedAt time.Time, err error, consecutiveFailures int, success bool) {
	r.mu.Lock()
	defer r.mu.Unlock()

	r.metrics.LastDurationMs = duration.Milliseconds()
	r.metrics.ConsecutiveFailures = consecutiveFailures
	if err != nil {
		r.metrics.LastError = err.Error()
		r.metrics.FailureCount++
	} else {
		r.metrics.LastError = ""
		if success {
			r.metrics.SuccessCount++
		}
	}
	if !collectedAt.IsZero() {
		r.metrics.LastCollected = collectedAt.UnixMilli()
	}
}

// RecordMetricsActive tracks whether the metrics poller is currently running.
func (r *Recorder) RecordMetricsActive(active bool) {
	if r == nil {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.metrics.Active = active
}

// RecordRetryAttempt increments retry-attempt counters.
func (r *Recorder) RecordRetryAttempt(err error) {
	if r == nil {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.connection.RetryAttempts++
	if err != nil {
		r.connection.LastRetryError = err.Error()
	}
}

// RecordRetrySuccess signals that a retry eventually succeeded.
func (r *Recorder) RecordRetrySuccess() {
	if r == nil {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.connection.RetrySuccesses++
}

// RecordRetryExhausted increments the exhausted counter.
func (r *Recorder) RecordRetryExhausted(err error) {
	if r == nil {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.connection.RetryExhausted++
	if err != nil {
		r.connection.LastRetryError = err.Error()
	}
}

// RecordTransportRebuild notes that the backend attempted a transport-level rebuild.
func (r *Recorder) RecordTransportRebuild(reason string) {
	if r == nil {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.connection.TransportRebuilds++
	r.connection.LastTransportReason = reason
}

// RecordConnectionState captures the current backend connection status.
func (r *Recorder) RecordConnectionState(state, label, message string, nextRetryMs, updatedAt int64) {
	if r == nil {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.connection.State = state
	r.connection.StateLabel = label
	r.connection.StateMessage = message
	r.connection.NextRetryMs = nextRetryMs
	r.connection.LastUpdated = updatedAt
}

// SnapshotSummary returns a copy of the current telemetry summary.
func (r *Recorder) SnapshotSummary() Summary {
	r.mu.RLock()
	defer r.mu.RUnlock()

	out := Summary{
		Metrics:    r.metrics,
		Snapshots:  make([]SnapshotStatus, 0, len(r.snapshots)),
		Streams:    make([]StreamStatus, 0, len(r.streams)),
		Connection: r.connection,
	}
	if r.catalog.LastUpdated != 0 {
		catalogCopy := r.catalog
		out.Catalog = &catalogCopy
	}
	for _, value := range r.snapshots {
		snapshot := *value
		if len(value.Warnings) > 0 {
			snapshot.Warnings = append([]string(nil), value.Warnings...)
		}
		out.Snapshots = append(out.Snapshots, snapshot)
	}
	for _, value := range r.streams {
		stream := *value
		out.Streams = append(out.Streams, stream)
	}
	return out
}

// StreamStatus captures health metrics for streaming transports (events/logs/resources).
type StreamStatus struct {
	Name            string `json:"name"`
	ActiveSessions  int    `json:"activeSessions"`
	TotalMessages   uint64 `json:"totalMessages"`
	DroppedMessages uint64 `json:"droppedMessages"`
	ErrorCount      uint64 `json:"errorCount"`
	LastConnect     int64  `json:"lastConnect"`
	LastEvent       int64  `json:"lastEvent"`
	LastError       string `json:"lastError,omitempty"`
}

// Stream name identifiers used across the backend/frontend telemetry contract.
const (
	StreamEvents    = "events"
	StreamLogs      = "object-logs"
	StreamCatalog   = "catalog"
	StreamResources = "resources"
)

// RecordStreamConnect increments the active session count for a stream.
func (r *Recorder) RecordStreamConnect(name string) {
	r.updateStream(name, func(status *StreamStatus) {
		status.ActiveSessions++
		status.LastConnect = time.Now().UnixMilli()
	})
}

// RecordStreamDisconnect decrements the active session count for a stream.
func (r *Recorder) RecordStreamDisconnect(name string) {
	r.updateStream(name, func(status *StreamStatus) {
		if status.ActiveSessions > 0 {
			status.ActiveSessions--
		}
	})
}

// RecordStreamDelivery captures successful deliveries and throttled drops.
func (r *Recorder) RecordStreamDelivery(name string, delivered, dropped int) {
	if delivered <= 0 && dropped <= 0 {
		return
	}
	r.updateStream(name, func(status *StreamStatus) {
		now := time.Now().UnixMilli()
		if delivered > 0 {
			status.TotalMessages += uint64(delivered)
			status.LastEvent = now
			if dropped <= 0 && status.LastError == "subscriber backlog" {
				status.LastError = ""
			}
		}
		if dropped > 0 {
			status.DroppedMessages += uint64(dropped)
			status.ErrorCount++
			status.LastError = "subscriber backlog"
			status.LastEvent = now
		}
	})
}

// RecordStreamError captures an error emitted while serving a stream.
func (r *Recorder) RecordStreamError(name string, err error) {
	if err == nil {
		return
	}
	r.updateStream(name, func(status *StreamStatus) {
		status.ErrorCount++
		status.LastError = err.Error()
	})
}

func (r *Recorder) updateStream(name string, fn func(*StreamStatus)) {
	if name == "" || fn == nil {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()

	status, ok := r.streams[name]
	if !ok {
		status = &StreamStatus{Name: name}
		r.streams[name] = status
	}

	fn(status)
}
