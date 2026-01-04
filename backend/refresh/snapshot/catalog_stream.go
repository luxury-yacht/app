package snapshot

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/luxury-yacht/app/backend/objectcatalog"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/logstream"
	"github.com/luxury-yacht/app/backend/refresh/telemetry"
)

type catalogStreamHandler struct {
	service     func() *objectcatalog.Service
	telemetry   *telemetry.Recorder
	logger      logstream.Logger
	clusterMeta ClusterMeta
}

// catalogStreamSnapshotMode marks whether the stream payload represents a full snapshot or a partial update.
type catalogStreamSnapshotMode string

const (
	catalogStreamSnapshotFull    catalogStreamSnapshotMode = "full"
	catalogStreamSnapshotPartial catalogStreamSnapshotMode = "partial"
)

// NewCatalogStreamHandler returns an SSE handler that streams catalog updates.
func NewCatalogStreamHandler(
	service func() *objectcatalog.Service,
	logger logstream.Logger,
	recorder *telemetry.Recorder,
	meta ClusterMeta,
) http.Handler {
	return &catalogStreamHandler{service: service, telemetry: recorder, logger: logger, clusterMeta: meta}
}

func (h *catalogStreamHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	svc := h.service()
	if svc == nil {
		http.Error(w, "catalog streaming unavailable", http.StatusServiceUnavailable)
		return
	}

	scope := r.URL.RawQuery
	opts, err := parseBrowseScope(scope)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	f, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming not supported", http.StatusInternalServerError)
		return
	}

	if h.telemetry != nil {
		h.telemetry.RecordStreamConnect(telemetry.StreamCatalog)
		defer h.telemetry.RecordStreamDisconnect(telemetry.StreamCatalog)
	}

	origin := r.Header.Get("Origin")
	if origin == "" {
		origin = "*"
	}
	w.Header().Set("Access-Control-Allow-Origin", origin)
	w.Header().Set("Vary", "Origin")
	if origin != "*" {
		w.Header().Set("Access-Control-Allow-Credentials", "true")
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	signals, cancel := svc.SubscribeStreaming()
	defer cancel()

	ctx := r.Context()

	sequence := uint64(0)
	nextSequence := func() uint64 {
		sequence++
		return sequence
	}

	if err := h.writeSnapshot(w, f, svc, opts, svc.CachesReady(), true, nextSequence()); err != nil {
		if h.telemetry != nil {
			h.telemetry.RecordStreamError(telemetry.StreamCatalog, err)
		}
		return
	}

	if h.telemetry != nil {
		h.telemetry.RecordStreamDelivery(telemetry.StreamCatalog, 1, 0)
	}

	for {
		select {
		case <-ctx.Done():
			return
		case update, ok := <-signals:
			if !ok {
				return
			}
			if err := h.writeSnapshot(w, f, svc, opts, update.Ready, false, nextSequence()); err != nil {
				if h.telemetry != nil {
					h.telemetry.RecordStreamError(telemetry.StreamCatalog, err)
				}
				return
			}
			if h.telemetry != nil {
				h.telemetry.RecordStreamDelivery(telemetry.StreamCatalog, 1, 0)
			}
		}
	}
}

type catalogStreamEvent struct {
	Reset        bool                      `json:"reset,omitempty"`
	Ready        bool                      `json:"ready"`
	CacheReady   bool                      `json:"cacheReady"`
	Truncated    bool                      `json:"truncated"`
	SnapshotMode catalogStreamSnapshotMode `json:"snapshotMode"`
	Snapshot     CatalogSnapshot           `json:"snapshot"`
	Stats        refresh.SnapshotStats     `json:"stats"`
	GeneratedAt  int64                     `json:"generatedAt"`
	Sequence     uint64                    `json:"sequence"`
}

func (h *catalogStreamHandler) writeSnapshot(
	w http.ResponseWriter,
	f http.Flusher,
	svc *objectcatalog.Service,
	opts browseQueryOptions,
	ready bool,
	reset bool,
	sequence uint64,
) error {
	result := svc.Query(opts.toQueryOptions())
	health := svc.Health()
	cachesReady := svc.CachesReady()

	payload, truncated := buildCatalogSnapshot(result, opts, health, cachesReady, ready)
	// Ensure streaming payloads include stable cluster identifiers.
	payload.ClusterMeta = h.clusterMeta
	payload.NamespaceGroups = buildCatalogNamespaceGroups(svc, h.clusterMeta, nil, opts.Namespaces)
	if payload.FirstBatchLatencyMs == 0 {
		if latency := svc.FirstBatchLatency(); latency > 0 {
			payload.FirstBatchLatencyMs = latency.Milliseconds()
		}
	}

	stats := refresh.SnapshotStats{
		ItemCount:    len(payload.Items),
		TotalItems:   result.TotalItems,
		Truncated:    truncated,
		BatchIndex:   payload.BatchIndex,
		BatchSize:    payload.BatchSize,
		TotalBatches: payload.TotalBatches,
		IsFinalBatch: payload.IsFinal,
	}
	if payload.FirstBatchLatencyMs > 0 {
		stats.TimeToFirstRowMs = payload.FirstBatchLatencyMs
	}

	snapshotMode := catalogStreamSnapshotFull
	if !payload.IsFinal || truncated {
		snapshotMode = catalogStreamSnapshotPartial
	}

	event := catalogStreamEvent{
		Reset:        reset,
		Ready:        ready && payload.IsFinal,
		CacheReady:   cachesReady,
		Truncated:    truncated,
		SnapshotMode: snapshotMode,
		Snapshot:     payload,
		Stats:        stats,
		GeneratedAt:  time.Now().UnixMilli(),
		Sequence:     sequence,
	}

	body, err := json.Marshal(event)
	if err != nil {
		return err
	}

	if _, err := fmt.Fprintf(w, "data: %s\n\n", body); err != nil {
		return err
	}
	f.Flush()
	return nil
}
