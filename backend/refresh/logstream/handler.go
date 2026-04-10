package logstream

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/luxury-yacht/app/backend/internal/podlogs"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/client-go/kubernetes"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/telemetry"
)

const (
	defaultTailLines = 1000
	maxTailLines     = 10000
	batchMaxSize     = 64
)

const logPermissionResource = "core/pods/log"
const transportDropWarning = "Live log stream dropped one or more log entries due to client backlog. These lines were not intentionally filtered."

// Handler exposes an SSE endpoint for streaming pod/workload logs.
type Handler struct {
	streamer  *Streamer
	telemetry *telemetry.Recorder
	limiter   *GlobalTargetLimiter
}

// permissionDeniedError preserves the original message while exposing details for structured payloads.
type permissionDeniedError struct {
	domain   string
	resource string
	message  string
}

func (e permissionDeniedError) Error() string {
	return e.message
}

func (e permissionDeniedError) PermissionDeniedDetails() refresh.PermissionDeniedDetails {
	return refresh.PermissionDeniedDetails{
		Domain:   e.domain,
		Resource: e.resource,
	}
}

// NewHandler constructs a log stream handler.
func NewHandler(client kubernetes.Interface, logger Logger, recorder *telemetry.Recorder, limiters ...*GlobalTargetLimiter) (*Handler, error) {
	if client == nil {
		return nil, errors.New("logstream: kubernetes client is required")
	}
	var limiter *GlobalTargetLimiter
	if len(limiters) > 0 {
		limiter = limiters[0]
	}
	return &Handler{streamer: NewStreamer(client, logger, recorder), telemetry: recorder, limiter: limiter}, nil
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
	w.Header().Set("X-Accel-Buffering", "no") // Disable nginx buffering
	f.Flush()                                 // Send headers immediately

	sequence := uint64(1)

	// Send an immediate "connected" event so the frontend knows the stream is active
	// This prevents the UI from staying in loading state when there are no initial logs
	connectedPayload := EventPayload{
		Domain:      "object-logs",
		Scope:       opts.ScopeString,
		Sequence:    sequence,
		GeneratedAt: time.Now().UnixMilli(),
		Reset:       true,
		Entries:     []Entry{},
	}
	sequence++
	if writeEvent(w, f, connectedPayload) != nil {
		return
	}

	ctx := r.Context()
	if deadline, ok := ctx.Deadline(); ok {
		h.streamer.logger.Debug(fmt.Sprintf("logstream: client deadline %s", deadline.Format(time.RFC3339)), "LogStream")
	}

	var limiterSession *TargetSession
	if h.limiter != nil {
		limiterSession = h.limiter.StartSession(opts.ClusterID, opts.ScopeString)
		defer limiterSession.Release()
	}

	initial, states, pods, selector, warnings, skippedTargets, skipReason, err := h.streamer.tail(ctx, opts, limiterSession)
	if err != nil {
		if h.telemetry != nil {
			h.telemetry.RecordStreamError(streamName, err)
		}
		h.streamer.logger.Warn(fmt.Sprintf("logstream: initial tail failed: %v", err), "LogStream")
		if status := permissionDeniedStatus(err); status != nil {
			payload := EventPayload{
				Domain:       "object-logs",
				Scope:        opts.ScopeString,
				Sequence:     sequence,
				GeneratedAt:  time.Now().UnixMilli(),
				Error:        err.Error(),
				ErrorDetails: status,
			}
			_ = writeEvent(w, f, payload)
			return
		}
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if h.telemetry != nil && skippedTargets > 0 {
		h.telemetry.RecordStreamSkippedTargets(streamName, skippedTargets, skipReason)
	}

	// Always send the initial event so frontend knows initial fetch is complete
	// (even if there are no logs). This allows the frontend to distinguish between
	// "still loading" and "no logs available".
	event := EventPayload{
		Domain:      "object-logs",
		Scope:       opts.ScopeString,
		Sequence:    sequence,
		GeneratedAt: time.Now().UnixMilli(),
		// The initial snapshot must replace any preserved client buffer.
		// The frontend intentionally keeps the previous buffer across
		// tab switches/reconnect handshakes, so sending the first real
		// snapshot with Reset=false causes the entire initial batch to be
		// appended on remount.
		Reset:       true,
		Entries:     initial,
		Warnings:    warningPayload(warnings, false),
	}
	sequence++
	if err := writeEvent(w, f, event); err != nil {
		if h.telemetry != nil {
			h.telemetry.RecordStreamError(streamName, err)
		}
		return
	}
	if h.telemetry != nil && len(initial) > 0 {
		h.telemetry.RecordStreamDelivery(streamName, len(event.Entries), 0)
	}

	entriesCh := make(chan Entry, 256)
	dropCh := make(chan int, 1024)
	errCh := make(chan error, 1)
	warningsCh := make(chan []string, 8)

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
			close(warningsCh)
		}()
		h.streamer.run(ctx, opts, pods, selector, states, limiterSession, warnings, entriesCh, warningsCh, errCh, dropCh)
	}()

	keepAlive := time.NewTicker(config.LogStreamKeepAliveInterval)
	defer keepAlive.Stop()
	heartbeat := time.NewTicker(config.StreamHeartbeatInterval)
	defer heartbeat.Stop()
	lastDelivery := time.Now()

	var (
		batch                  []Entry
		batchTimer             *time.Timer
		pendingDropped         int
		selectionWarnings      = append([]string(nil), warnings...)
		emittedWarnings        = append([]string(nil), warnings...)
		transportDropObserved  bool
	)

	emitWarningUpdate := func() bool {
		nextWarnings := composeStreamWarnings(selectionWarnings, transportDropObserved)
		if stringSlicesEqual(emittedWarnings, nextWarnings) {
			return false
		}
		payload := EventPayload{
			Domain:      "object-logs",
			Scope:       opts.ScopeString,
			Sequence:    sequence,
			GeneratedAt: time.Now().UnixMilli(),
			Warnings:    warningPayload(nextWarnings, true),
		}
		sequence++
		if writeEvent(w, f, payload) != nil {
			if h.telemetry != nil {
				h.telemetry.RecordStreamError(streamName, fmt.Errorf("logstream: failed to write warning update"))
			}
			return true
		}
		emittedWarnings = append(emittedWarnings[:0], nextWarnings...)
		return false
	}

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
		if pendingDropped > 0 && !transportDropObserved {
			transportDropObserved = true
			if emitWarningUpdate() {
				return true
			}
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
			if status := permissionDeniedStatus(err); status != nil {
				errPayload.ErrorDetails = status
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
		case warnings, ok := <-warningsCh:
			if !ok {
				continue
			}
			selectionWarnings = append(selectionWarnings[:0], warnings...)
			if emitWarningUpdate() {
				return
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
			if pendingDropped > 0 && !transportDropObserved && len(batch) == 0 {
				transportDropObserved = true
				if emitWarningUpdate() {
					return
				}
			}
			if h.telemetry != nil && len(batch) == 0 {
				h.telemetry.RecordStreamDelivery(streamName, 0, pendingDropped)
				pendingDropped = 0
			}
		}
	}
}

func composeStreamWarnings(selectionWarnings []string, transportDropObserved bool) []string {
	if !transportDropObserved {
		return append([]string(nil), selectionWarnings...)
	}
	combined := make([]string, 0, len(selectionWarnings)+1)
	combined = append(combined, selectionWarnings...)
	combined = append(combined, transportDropWarning)
	return combined
}

func warningPayload(warnings []string, includeEmpty bool) *[]string {
	if len(warnings) == 0 && !includeEmpty {
		return nil
	}
	copied := append([]string(nil), warnings...)
	return &copied
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
	clusterIDs, _ := refresh.SplitClusterScopeList(rawScope)

	identity, err := refresh.ParseObjectScope(rawScope)
	if err != nil {
		return Options{}, err
	}
	if strings.TrimSpace(identity.GVK.Version) == "" {
		return Options{}, errors.New("log scope must include apiVersion")
	}
	if identity.Namespace == "" {
		return Options{}, errors.New("log scope must reference a namespaced object")
	}
	podFilter := strings.TrimSpace(r.URL.Query().Get("pod"))
	podInclude := strings.TrimSpace(r.URL.Query().Get("podInclude"))
	podExclude := strings.TrimSpace(r.URL.Query().Get("podExclude"))
	container := strings.TrimSpace(r.URL.Query().Get("container"))
	includeInit := parseBoolQueryWithDefault(r, "includeInit", true)
	includeEphemeral := parseBoolQueryWithDefault(r, "includeEphemeral", true)
	containerState, err := podlogs.ParseContainerStateFilter(strings.TrimSpace(r.URL.Query().Get("containerState")))
	if err != nil {
		return Options{}, fmt.Errorf("invalid container state filter: %w", err)
	}
	include := strings.TrimSpace(r.URL.Query().Get("include"))
	exclude := strings.TrimSpace(r.URL.Query().Get("exclude"))
	tail := defaultTailLines
	if rawTail := strings.TrimSpace(r.URL.Query().Get("tailLines")); rawTail != "" {
		if parsed, err := strconv.Atoi(rawTail); err == nil && parsed > 0 {
			tail = min(parsed, maxTailLines)
		}
	}
	lineFilter, err := podlogs.NewLineFilter(include, exclude)
	if err != nil {
		return Options{}, fmt.Errorf("invalid log filter: %w", err)
	}
	podNameFilter, err := podlogs.NewPodNameFilter(podInclude, podExclude)
	if err != nil {
		return Options{}, fmt.Errorf("invalid pod filter: %w", err)
	}
	return Options{
		ClusterID: func() string {
			if len(clusterIDs) == 1 {
				return clusterIDs[0]
			}
			return ""
		}(),
		Namespace:        identity.Namespace,
		Kind:             strings.ToLower(strings.TrimSpace(identity.GVK.Kind)),
		Name:             strings.TrimSpace(identity.Name),
		PodFilter:        podFilter,
		PodInclude:       podInclude,
		PodExclude:       podExclude,
		Container:        container,
		IncludeInit:      includeInit,
		IncludeEphemeral: includeEphemeral,
		ContainerState:   containerState,
		Include:          include,
		Exclude:          exclude,
		PodNameFilter:    podNameFilter,
		LineFilter:       lineFilter,
		TailLines:        tail,
		// Keep the original scope for client-side keying.
		ScopeString: rawScope,
	}, nil
}

func parseBoolQueryWithDefault(r *http.Request, key string, defaultValue bool) bool {
	raw := strings.TrimSpace(r.URL.Query().Get(key))
	if raw == "" {
		return defaultValue
	}
	switch strings.ToLower(raw) {
	case "1", "true", "yes", "on":
		return true
	case "0", "false", "no", "off":
		return false
	default:
		return defaultValue
	}
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

// permissionDeniedStatus translates forbidden log errors into Status-like payloads.
func permissionDeniedStatus(err error) *refresh.PermissionDeniedStatus {
	if status, ok := refresh.PermissionDeniedStatusFromError(err); ok {
		return status
	}
	if apierrors.IsForbidden(err) {
		wrapped := permissionDeniedError{
			domain:   "object-logs",
			resource: logPermissionResource,
			message:  err.Error(),
		}
		if status, ok := refresh.PermissionDeniedStatusFromError(wrapped); ok {
			return status
		}
	}
	return nil
}
