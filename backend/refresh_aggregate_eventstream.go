package backend

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/eventstream"
	"github.com/luxury-yacht/app/backend/refresh/snapshot"
	"github.com/luxury-yacht/app/backend/refresh/telemetry"
)

// eventStreamSubscriber provides the subscription surface needed for aggregation.
type eventStreamSubscriber interface {
	Subscribe(scope string) (<-chan eventstream.StreamEvent, context.CancelFunc)
}

// aggregateEventStreamHandler merges event streams across multiple clusters.
type aggregateEventStreamHandler struct {
	snapshotService refresh.SnapshotService
	managers        map[string]eventStreamSubscriber
	clusterMeta     map[string]snapshot.ClusterMeta
	clusterOrder    []string
	telemetry       *telemetry.Recorder
	logger          eventstream.Logger
	buffers         map[string]*aggregateEventBuffer
	sequences       map[string]uint64
	mu              sync.Mutex
}

// aggregateEventScope stores the parsed scope data for event stream routing.
type aggregateEventScope struct {
	Domain         string
	ScopeKey       string
	SubscribeScope string
	SnapshotScope  string
	ClusterToken   string
	ClusterIDs     []string
}

// newAggregateEventStreamHandler builds an aggregated /api/v2/stream/events handler.
func newAggregateEventStreamHandler(
	snapshotService refresh.SnapshotService,
	managers map[string]eventStreamSubscriber,
	clusterMeta map[string]snapshot.ClusterMeta,
	clusterOrder []string,
	recorder *telemetry.Recorder,
	logger eventstream.Logger,
) *aggregateEventStreamHandler {
	if logger == nil {
		logger = noopLogger{}
	}
	return &aggregateEventStreamHandler{
		snapshotService: snapshotService,
		managers:        managers,
		clusterMeta:     clusterMeta,
		clusterOrder:    clusterOrder,
		telemetry:       recorder,
		logger:          logger,
		buffers:         make(map[string]*aggregateEventBuffer),
		sequences:       make(map[string]uint64),
	}
}

// ServeHTTP implements http.Handler for the aggregated event stream endpoint.
func (h *aggregateEventStreamHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if ok := applyEventCORS(w, r); !ok {
		return
	}

	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	f, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming not supported", http.StatusInternalServerError)
		return
	}

	rawScope := strings.TrimSpace(r.URL.Query().Get("scope"))
	params, err := parseAggregateEventScope(rawScope)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()

	targets, err := h.resolveTargets(params.ClusterIDs)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if len(targets) == 0 {
		http.Error(w, "no clusters available for events", http.StatusServiceUnavailable)
		return
	}

	streamName := telemetry.StreamEvents
	if h.telemetry != nil {
		h.telemetry.RecordStreamConnect(streamName)
		defer h.telemetry.RecordStreamDisconnect(streamName)
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	resumeID := parseAggregateResumeID(r)
	resumeEvents, resumeOK := h.bufferSince(params.ScopeKey, resumeID)
	if resumeID == 0 || !resumeOK {
		snapshotScope := refresh.JoinClusterScope(params.ClusterToken, params.SnapshotScope)
		snapshotPayload, err := h.snapshotService.Build(ctx, params.Domain, snapshotScope)
		if err != nil {
			if h.telemetry != nil {
				h.telemetry.RecordStreamError(streamName, err)
			}
			h.logger.Warn(fmt.Sprintf("eventstream: initial snapshot failed: %v", err), "EventStream")
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		initialEvents := convertAggregateSnapshot(snapshotPayload)
		payload := eventstream.Payload{
			Domain:      params.Domain,
			Scope:       params.ScopeKey,
			Sequence:    h.nextAggregateSequence(params.ScopeKey),
			GeneratedAt: time.Now().UnixMilli(),
			Reset:       true,
			Events:      initialEvents,
		}
		if err := writeEventPayload(w, f, payload); err != nil {
			if h.telemetry != nil {
				h.telemetry.RecordStreamError(streamName, err)
			}
			return
		}
		if h.telemetry != nil {
			h.telemetry.RecordStreamDelivery(streamName, len(initialEvents), 0)
		}
	} else if len(resumeEvents) > 0 {
		for _, item := range resumeEvents {
			payload := eventstream.Payload{
				Domain:      params.Domain,
				Scope:       params.ScopeKey,
				Sequence:    item.Sequence,
				GeneratedAt: time.Now().UnixMilli(),
				Events:      []eventstream.Entry{item.Entry},
			}
			if err := writeEventPayload(w, f, payload); err != nil {
				if h.telemetry != nil {
					h.telemetry.RecordStreamError(streamName, err)
				}
				return
			}
		}
		if h.telemetry != nil {
			h.telemetry.RecordStreamDelivery(streamName, len(resumeEvents), 0)
		}
	}

	entryCh := make(chan streamEntry, config.AggregateEventStreamEntryBufferSize)
	cancelFns := make([]context.CancelFunc, 0, len(targets))
	for _, id := range targets {
		manager := h.managers[id]
		if manager == nil {
			continue
		}
		ch, cancel := manager.Subscribe(params.SubscribeScope)
		if ch == nil {
			cancel()
			if h.telemetry != nil {
				h.telemetry.RecordStreamError(streamName, fmt.Errorf("subscriber limit reached for %s", id))
			}
			continue
		}
		cancelFns = append(cancelFns, cancel)
		go h.forwardEntries(ctx, id, ch, entryCh)
	}
	defer func() {
		for _, cancel := range cancelFns {
			cancel()
		}
	}()

	keepAlive := time.NewTicker(config.EventStreamKeepAliveInterval)
	defer keepAlive.Stop()
	heartbeat := time.NewTicker(config.StreamHeartbeatInterval)
	defer heartbeat.Stop()
	lastDelivery := time.Now()

	for {
		select {
		case <-r.Context().Done():
			return
		case entry := <-entryCh:
			lastDelivery = time.Now()
			sequence := h.nextAggregateSequence(params.ScopeKey)
			h.bufferAggregateEvent(params.ScopeKey, sequence, entry.entry)
			payload := eventstream.Payload{
				Domain:      params.Domain,
				Scope:       params.ScopeKey,
				Sequence:    sequence,
				GeneratedAt: time.Now().UnixMilli(),
				Events:      []eventstream.Entry{h.decorateEntry(entry)},
			}
			if err := writeEventPayload(w, f, payload); err != nil {
				if h.telemetry != nil {
					h.telemetry.RecordStreamError(streamName, err)
				}
				return
			}
			if h.telemetry != nil {
				h.telemetry.RecordStreamDelivery(streamName, len(payload.Events), 0)
			}
		case <-keepAlive.C:
			if _, err := w.Write([]byte(": keep-alive\n\n")); err != nil {
				if h.telemetry != nil {
					h.telemetry.RecordStreamError(streamName, err)
				}
				return
			}
			f.Flush()
		case <-heartbeat.C:
			if time.Since(lastDelivery) > config.StreamHeartbeatTimeout {
				if h.telemetry != nil {
					h.telemetry.RecordStreamError(streamName, fmt.Errorf("eventstream heartbeat timeout"))
				}
				lastDelivery = time.Now()
			}
		}
	}
}

type streamEntry struct {
	clusterID string
	entry     eventstream.Entry
}

// forwardEntries forwards cluster events into the aggregate stream channel.
func (h *aggregateEventStreamHandler) forwardEntries(
	ctx context.Context,
	clusterID string,
	ch <-chan eventstream.StreamEvent,
	out chan<- streamEntry,
) {
	for {
		select {
		case <-ctx.Done():
			return
		case event, ok := <-ch:
			if !ok {
				return
			}
			select {
			case out <- streamEntry{clusterID: clusterID, entry: event.Entry}:
			case <-ctx.Done():
				return
			}
		}
	}
}

type aggregateBufferItem struct {
	Sequence uint64
	Entry    eventstream.Entry
}

type aggregateEventBuffer struct {
	items []aggregateBufferItem
	start int
	count int
	max   int
}

func newAggregateEventBuffer(max int) *aggregateEventBuffer {
	return &aggregateEventBuffer{
		items: make([]aggregateBufferItem, max),
		max:   max,
	}
}

func (b *aggregateEventBuffer) add(item aggregateBufferItem) {
	if b.max == 0 {
		return
	}
	if b.count < b.max {
		index := (b.start + b.count) % b.max
		b.items[index] = item
		b.count++
		return
	}
	b.items[b.start] = item
	b.start = (b.start + 1) % b.max
}

func (b *aggregateEventBuffer) since(sequence uint64) ([]aggregateBufferItem, bool) {
	if b.count == 0 {
		return nil, false
	}
	oldest := b.items[b.start].Sequence
	latestIndex := (b.start + b.count - 1) % b.max
	latest := b.items[latestIndex].Sequence
	if sequence < oldest {
		return nil, false
	}
	if sequence >= latest {
		return []aggregateBufferItem{}, true
	}
	out := make([]aggregateBufferItem, 0, b.count)
	for i := 0; i < b.count; i++ {
		index := (b.start + i) % b.max
		item := b.items[index]
		if item.Sequence > sequence {
			out = append(out, item)
		}
	}
	return out, true
}

// resolveTargets selects the clusters to stream from based on the requested IDs.
func (h *aggregateEventStreamHandler) resolveTargets(clusterIDs []string) ([]string, error) {
	if len(clusterIDs) > 0 {
		targets := make([]string, 0, len(clusterIDs))
		for _, id := range clusterIDs {
			if _, ok := h.managers[id]; !ok {
				return nil, fmt.Errorf("cluster %s not active", id)
			}
			targets = append(targets, id)
		}
		return targets, nil
	}

	ordered := make([]string, 0, len(h.clusterOrder))
	for _, id := range h.clusterOrder {
		if _, ok := h.managers[id]; ok {
			ordered = append(ordered, id)
		}
	}
	if len(ordered) > 0 {
		return ordered, nil
	}

	targets := make([]string, 0, len(h.managers))
	for id := range h.managers {
		targets = append(targets, id)
	}
	sort.Strings(targets)
	return targets, nil
}

// decorateEntry attaches cluster metadata to event stream entries when missing.
func (h *aggregateEventStreamHandler) decorateEntry(entry streamEntry) eventstream.Entry {
	event := entry.entry
	if meta, ok := h.clusterMeta[entry.clusterID]; ok {
		if event.ClusterID == "" {
			event.ClusterID = meta.ClusterID
		}
		if event.ClusterName == "" {
			event.ClusterName = meta.ClusterName
		}
	}
	if event.ClusterID == "" {
		event.ClusterID = entry.clusterID
	}
	return event
}

// parseAggregateEventScope normalizes cluster and namespace event scope tokens.
func parseAggregateEventScope(raw string) (aggregateEventScope, error) {
	if strings.TrimSpace(raw) == "" {
		return aggregateEventScope{}, fmt.Errorf("invalid scope")
	}
	clusterToken, _ := refresh.SplitClusterScope(raw)
	clusterIDs, scopeValue := refresh.SplitClusterScopeList(raw)
	scopeValue = strings.TrimSpace(scopeValue)
	if scopeValue == "" || scopeValue == "cluster" {
		return aggregateEventScope{
			Domain:         "cluster-events",
			ScopeKey:       refresh.JoinClusterScope(clusterToken, "cluster"),
			SubscribeScope: "cluster",
			SnapshotScope:  "",
			ClusterToken:   clusterToken,
			ClusterIDs:     clusterIDs,
		}, nil
	}
	if strings.HasPrefix(scopeValue, "namespace:") {
		ns := strings.TrimSpace(strings.TrimPrefix(scopeValue, "namespace:"))
		if ns == "" {
			return aggregateEventScope{}, fmt.Errorf("invalid scope")
		}
		return aggregateEventScope{
			Domain:         "namespace-events",
			ScopeKey:       refresh.JoinClusterScope(clusterToken, "namespace:"+ns),
			SubscribeScope: "namespace:" + ns,
			SnapshotScope:  ns,
			ClusterToken:   clusterToken,
			ClusterIDs:     clusterIDs,
		}, nil
	}
	return aggregateEventScope{}, fmt.Errorf("invalid scope")
}

// convertAggregateSnapshot flattens snapshot payloads into stream entries.
func convertAggregateSnapshot(snap *refresh.Snapshot) []eventstream.Entry {
	if snap == nil || snap.Payload == nil {
		return nil
	}
	switch payload := snap.Payload.(type) {
	case snapshot.ClusterEventsSnapshot:
		entries := make([]eventstream.Entry, 0, len(payload.Events))
		for _, evt := range payload.Events {
			entries = append(entries, eventstream.Entry{
				ClusterID:       evt.ClusterID,
				ClusterName:     evt.ClusterName,
				Kind:            evt.Kind,
				Name:            evt.Name,
				Namespace:       evt.ObjectNamespace,
				ObjectNamespace: evt.ObjectNamespace,
				Type:            evt.Type,
				Source:          evt.Source,
				Reason:          evt.Reason,
				Object:          evt.Object,
				Message:         evt.Message,
				Age:             evt.Age,
			})
		}
		return entries
	case snapshot.NamespaceEventsSnapshot:
		entries := make([]eventstream.Entry, 0, len(payload.Events))
		for _, evt := range payload.Events {
			entries = append(entries, eventstream.Entry{
				ClusterID:       evt.ClusterID,
				ClusterName:     evt.ClusterName,
				Kind:            evt.Kind,
				Name:            evt.Name,
				Namespace:       evt.ObjectNamespace,
				ObjectNamespace: evt.ObjectNamespace,
				Type:            evt.Type,
				Source:          evt.Source,
				Reason:          evt.Reason,
				Object:          evt.Object,
				Message:         evt.Message,
				Age:             evt.Age,
			})
		}
		return entries
	default:
		return nil
	}
}

// writeEventPayload serializes and flushes a single SSE payload.
func writeEventPayload(w http.ResponseWriter, f http.Flusher, payload eventstream.Payload) error {
	data, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	if _, err := fmt.Fprintf(w, "event: event\nid: %d\ndata: %s\n\n", payload.Sequence, data); err != nil {
		return err
	}
	f.Flush()
	return nil
}

// applyEventCORS applies permissive CORS headers for the event stream.
func applyEventCORS(w http.ResponseWriter, r *http.Request) bool {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return false
	}
	return true
}

func (h *aggregateEventStreamHandler) nextAggregateSequence(scope string) uint64 {
	if scope == "" {
		scope = "cluster"
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	next := h.sequences[scope] + 1
	h.sequences[scope] = next
	return next
}

func (h *aggregateEventStreamHandler) bufferAggregateEvent(
	scope string,
	sequence uint64,
	entry eventstream.Entry,
) {
	if scope == "" {
		scope = "cluster"
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	buffer := h.buffers[scope]
	if buffer == nil {
		buffer = newAggregateEventBuffer(config.AggregateEventStreamResumeBufferSize)
		h.buffers[scope] = buffer
	}
	buffer.add(aggregateBufferItem{Sequence: sequence, Entry: entry})
}

func (h *aggregateEventStreamHandler) bufferSince(
	scope string,
	sequence uint64,
) ([]aggregateBufferItem, bool) {
	if sequence == 0 {
		return nil, false
	}
	if scope == "" {
		scope = "cluster"
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	buffer := h.buffers[scope]
	if buffer == nil {
		return nil, false
	}
	return buffer.since(sequence)
}

func parseAggregateResumeID(r *http.Request) uint64 {
	if r == nil {
		return 0
	}
	raw := strings.TrimSpace(r.URL.Query().Get("since"))
	if raw == "" {
		raw = strings.TrimSpace(r.Header.Get("Last-Event-ID"))
	}
	if raw == "" {
		return 0
	}
	parsed, err := strconv.ParseUint(raw, 10, 64)
	if err != nil {
		return 0
	}
	return parsed
}

// noopLogger is used when no logger is supplied.
type noopLogger struct{}

func (noopLogger) Debug(string, ...string) {}
func (noopLogger) Info(string, ...string)  {}
func (noopLogger) Warn(string, ...string)  {}
func (noopLogger) Error(string, ...string) {}
