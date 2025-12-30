package logstream

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"k8s.io/client-go/kubernetes"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/telemetry"
)

const (
	defaultTailLines = 1000
	batchMaxSize     = 64
)

// Handler exposes an SSE endpoint for streaming pod/workload logs.
type Handler struct {
	streamer  *Streamer
	telemetry *telemetry.Recorder
}

// NewHandler constructs a log stream handler.
func NewHandler(client kubernetes.Interface, logger Logger, recorder *telemetry.Recorder) (*Handler, error) {
	if client == nil {
		return nil, errors.New("logstream: kubernetes client is required")
	}
	return &Handler{streamer: NewStreamer(client, logger, recorder), telemetry: recorder}, nil
}

// ServeHTTP implements http.Handler for the log streaming endpoint.
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if ok := applyCORS(w, r); !ok {
		return
	}

	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	f, ok := w.(http.Flusher)
	if !ok {
		h.streamer.logger.Warn("logstream: response does not implement http.Flusher", "LogStream")
		http.Error(w, "streaming not supported", http.StatusInternalServerError)
		return
	}

	opts, err := parseOptions(r)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	streamName := telemetry.StreamLogs
	if h.telemetry != nil {
		h.telemetry.RecordStreamConnect(streamName)
		defer h.telemetry.RecordStreamDisconnect(streamName)
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	ctx := r.Context()
	if deadline, ok := ctx.Deadline(); ok {
		h.streamer.logger.Debug(fmt.Sprintf("logstream: client deadline %s", deadline.Format(time.RFC3339)), "LogStream")
	}

	initial, states, pods, selector, err := h.streamer.tail(ctx, opts)
	if err != nil {
		if h.telemetry != nil {
			h.telemetry.RecordStreamError(streamName, err)
		}
		h.streamer.logger.Warn(fmt.Sprintf("logstream: initial tail failed: %v", err), "LogStream")
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	sequence := uint64(1)
	if len(initial) > 0 {
		event := EventPayload{
			Domain:      "object-logs",
			Scope:       opts.ScopeString,
			Sequence:    sequence,
			GeneratedAt: time.Now().UnixMilli(),
			Reset:       true,
			Entries:     initial,
		}
		sequence++
		if err := writeEvent(w, f, event); err != nil {
			if h.telemetry != nil {
				h.telemetry.RecordStreamError(streamName, err)
			}
			return
		}
		if h.telemetry != nil {
			h.telemetry.RecordStreamDelivery(streamName, len(event.Entries), 0)
		}
	}

	entriesCh := make(chan Entry, 256)
	dropCh := make(chan int, 1024)
	errCh := make(chan error, 1)

	go func() {
		defer func() {
			if r := recover(); r != nil {
				h.streamer.logger.Error(fmt.Sprintf("logstream: panic in stream handler: %v", r), "LogStream")
				if h.telemetry != nil {
					h.telemetry.RecordStreamError(streamName, fmt.Errorf("panic: %v", r))
				}
			}
			close(entriesCh)
			close(dropCh)
		}()
		h.streamer.run(ctx, opts, pods, selector, states, entriesCh, errCh, dropCh)
	}()

	keepAlive := time.NewTicker(config.LogStreamKeepAliveInterval)
	defer keepAlive.Stop()
	heartbeat := time.NewTicker(config.StreamHeartbeatInterval)
	defer heartbeat.Stop()
	lastDelivery := time.Now()

	var (
		batch          []Entry
		batchTimer     *time.Timer
		pendingDropped int
	)

	flushBatch := func() bool {
		delivered := len(batch)
		if delivered == 0 && pendingDropped == 0 {
			return false
		}
		if delivered > 0 {
			event := EventPayload{
				Domain:      "object-logs",
				Scope:       opts.ScopeString,
				Sequence:    sequence,
				GeneratedAt: time.Now().UnixMilli(),
				Entries:     batch,
			}
			sequence++
			batch = nil
			if err := writeEvent(w, f, event); err != nil {
				if h.telemetry != nil {
					h.telemetry.RecordStreamError(streamName, err)
				}
				return true
			}
		}
		if h.telemetry != nil {
			h.telemetry.RecordStreamDelivery(streamName, delivered, pendingDropped)
		}
		pendingDropped = 0
		lastDelivery = time.Now()
		return false
	}

	for {
		var batchChan <-chan time.Time
		if batchTimer != nil {
			batchChan = batchTimer.C
		}
		select {
		case <-ctx.Done():
			flushBatch()
			return
		case err := <-errCh:
			if err == nil {
				continue
			}
			errPayload := EventPayload{
				Domain:      "object-logs",
				Scope:       opts.ScopeString,
				Sequence:    sequence,
				GeneratedAt: time.Now().UnixMilli(),
				Error:       err.Error(),
			}
			sequence++
			if writeEvent(w, f, errPayload) != nil {
				if h.telemetry != nil {
					h.telemetry.RecordStreamError(streamName, err)
				}
				return
			}
			if h.telemetry != nil {
				h.telemetry.RecordStreamError(streamName, err)
			}
		case entry, ok := <-entriesCh:
			if !ok {
				flushBatch()
				if h.telemetry != nil && pendingDropped > 0 {
					h.telemetry.RecordStreamDelivery(streamName, 0, pendingDropped)
				}
				return
			}
			lastDelivery = time.Now()
			if batch == nil {
				batch = make([]Entry, 0, batchMaxSize)
			}
			batch = append(batch, entry)
			if len(batch) >= batchMaxSize {
				if flushBatch() {
					return
				}
				if batchTimer != nil {
					batchTimer.Stop()
					batchTimer = nil
				}
				continue
			}
			if batchTimer == nil {
				batchTimer = time.NewTimer(config.LogStreamBatchWindow)
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
					h.telemetry.RecordStreamError(streamName, fmt.Errorf("logstream heartbeat timeout"))
				}
				lastDelivery = time.Now()
			}
		case <-batchChan:
			batchTimer = nil
			if flushBatch() {
				return
			}
		case drop, ok := <-dropCh:
			if !ok {
				continue
			}
			pendingDropped += drop
			if h.telemetry != nil && len(batch) == 0 {
				h.telemetry.RecordStreamDelivery(streamName, 0, pendingDropped)
				pendingDropped = 0
			}
		}
	}
}

func writeEvent(w http.ResponseWriter, f http.Flusher, payload EventPayload) error {
	data, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	if _, err := fmt.Fprintf(w, "event: log\nid: %d\ndata: %s\n\n", payload.Sequence, data); err != nil {
		return err
	}
	f.Flush()
	return nil
}

func parseOptions(r *http.Request) (Options, error) {
	rawScope := strings.TrimSpace(r.URL.Query().Get("scope"))
	if rawScope == "" {
		return Options{}, errors.New("scope is required")
	}
	_, scope := refresh.SplitClusterScope(rawScope)
	parts := strings.Split(scope, ":")
	if len(parts) < 3 {
		return Options{}, errors.New("scope must be namespace:kind:name")
	}
	namespace := parts[0]
	kind := parts[1]
	name := strings.Join(parts[2:], ":")
	container := strings.TrimSpace(r.URL.Query().Get("container"))
	tail := defaultTailLines
	if rawTail := strings.TrimSpace(r.URL.Query().Get("tailLines")); rawTail != "" {
		if parsed, err := strconv.Atoi(rawTail); err == nil && parsed > 0 {
			tail = parsed
		}
	}
	return Options{
		Namespace:   namespace,
		Kind:        strings.ToLower(kind),
		Name:        name,
		Container:   container,
		TailLines:   tail,
		// Keep the original scope for client-side keying.
		ScopeString: rawScope,
	}, nil
}

func applyCORS(w http.ResponseWriter, r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin != "" {
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Vary", "Origin")
	}

	if r.Method == http.MethodOptions {
		w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		w.WriteHeader(http.StatusNoContent)
		return false
	}
	return true
}
