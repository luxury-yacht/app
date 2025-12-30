package eventstream

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/snapshot"
	"github.com/luxury-yacht/app/backend/refresh/telemetry"
)

const (
	keepAliveInterval = 15 * time.Second
)

// Handler exposes an SSE endpoint for streaming Kubernetes events.
type Handler struct {
	service   *snapshot.Service
	manager   *Manager
	logger    Logger
	telemetry *telemetry.Recorder
}

// NewHandler prepares an event stream handler.
func NewHandler(service *snapshot.Service, manager *Manager, logger Logger) (*Handler, error) {
	if service == nil {
		return nil, errors.New("eventstream: snapshot service required")
	}
	if manager == nil {
		return nil, errors.New("eventstream: manager required")
	}
	if logger == nil {
		logger = noopLogger{}
	}
	return &Handler{service: service, manager: manager, logger: logger, telemetry: manager.telemetry}, nil
}

// ServeHTTP implements http.Handler for /api/v2/stream/events.
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if ok := applyCORS(w, r); !ok {
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

	params := parseScope(r.URL.Query().Get("scope"))
	if params.Domain == "" {
		http.Error(w, "invalid scope", http.StatusBadRequest)
		return
	}
	streamName := telemetry.StreamEvents
	if h.telemetry != nil {
		h.telemetry.RecordStreamConnect(streamName)
		defer h.telemetry.RecordStreamDisconnect(streamName)
	}

	snapshotPayload, err := h.service.Build(r.Context(), params.Domain, params.SnapshotScope)
	if err != nil {
		if h.telemetry != nil {
			h.telemetry.RecordStreamError(streamName, err)
		}
		h.logger.Warn(fmt.Sprintf("eventstream: initial snapshot failed: %v", err), "EventStream")
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	sequence := uint64(1)
	initialEvents := convertSnapshot(snapshotPayload)
	payload := Payload{
		Domain:      params.Domain,
		Scope:       params.ScopeKey,
		Sequence:    sequence,
		GeneratedAt: time.Now().UnixMilli(),
		Reset:       true,
		Events:      initialEvents,
	}
	h.logger.Info(
		fmt.Sprintf(
			"eventstream: sending initial payload domain=%s scope=%s events=%d",
			payload.Domain,
			payload.Scope,
			len(initialEvents),
		),
		"EventStream",
	)
	sequence++
	if err := writeEvent(w, f, payload); err != nil {
		if h.telemetry != nil {
			h.telemetry.RecordStreamError(streamName, err)
		}
		return
	}
	if h.telemetry != nil {
		h.telemetry.RecordStreamDelivery(streamName, len(initialEvents), 0)
	}

	entries, cancel := h.manager.Subscribe(params.ScopeKey)
	defer cancel()

	keepAlive := time.NewTicker(keepAliveInterval)
	defer keepAlive.Stop()
	heartbeat := time.NewTicker(config.StreamHeartbeatInterval)
	defer heartbeat.Stop()
	lastDelivery := time.Now()

	for {
		select {
		case <-r.Context().Done():
			return
		case entry, ok := <-entries:
			if !ok {
				h.logger.Info("eventstream: subscriber channel closed", "EventStream")
				return
			}
			lastDelivery = time.Now()
			payload := Payload{
				Domain:      params.Domain,
				Scope:       params.ScopeKey,
				Sequence:    sequence,
				GeneratedAt: time.Now().UnixMilli(),
				Events:      []Entry{entry},
			}
			sequence++
			if err := writeEvent(w, f, payload); err != nil {
				if h.telemetry != nil {
					h.telemetry.RecordStreamError(streamName, err)
				}
				return
			}
			if h.telemetry != nil {
				h.telemetry.RecordStreamDelivery(streamName, len(payload.Events), 0)
			}
			h.logger.Debug(
				fmt.Sprintf(
					"eventstream: published event domain=%s scope=%s reason=%s",
					payload.Domain,
					payload.Scope,
					entry.Reason,
				),
				"EventStream",
			)
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

type scopeParams struct {
	Domain        string
	ScopeKey      string
	SnapshotScope string
}

func parseScope(raw string) scopeParams {
	clusterID, stripped := refresh.SplitClusterScope(raw)
	trimmed := strings.TrimSpace(stripped)
	if trimmed == "" || trimmed == "cluster" {
		return scopeParams{
			Domain:        "cluster-events",
			ScopeKey:      refresh.JoinClusterScope(clusterID, "cluster"),
			SnapshotScope: "",
		}
	}
	if strings.HasPrefix(trimmed, "namespace:") {
		ns := strings.TrimPrefix(trimmed, "namespace:")
		ns = strings.TrimSpace(ns)
		return scopeParams{
			Domain:        "namespace-events",
			ScopeKey:      refresh.JoinClusterScope(clusterID, "namespace:"+ns),
			SnapshotScope: ns,
		}
	}
	return scopeParams{}
}

func convertSnapshot(snap *refresh.Snapshot) []Entry {
	if snap == nil || snap.Payload == nil {
		return nil
	}
	switch payload := snap.Payload.(type) {
	case snapshot.ClusterEventsSnapshot:
		return convertClusterEntries(payload.Events)
	case snapshot.NamespaceEventsSnapshot:
		return convertNamespaceEntries(payload.Events)
	default:
		return nil
	}
}

func convertClusterEntries(events []snapshot.ClusterEventEntry) []Entry {
	entries := make([]Entry, 0, len(events))
	for _, evt := range events {
		entries = append(entries, Entry{
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
}

func convertNamespaceEntries(events []snapshot.EventSummary) []Entry {
	entries := make([]Entry, 0, len(events))
	for _, evt := range events {
		entries = append(entries, Entry{
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
}

func writeEvent(w http.ResponseWriter, f http.Flusher, payload Payload) error {
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

func applyCORS(w http.ResponseWriter, r *http.Request) bool {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return false
	}
	return true
}
