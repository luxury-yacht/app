package containerlogsstream

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/luxury-yacht/app/backend/internal/applog"
	"github.com/luxury-yacht/app/backend/internal/containerlogs"
	"github.com/luxury-yacht/app/backend/internal/logsources"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/client-go/kubernetes"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/telemetry"
)

const (
	containerLogsDomain   = "container-logs"
	logPermissionResource = "core/pods/log"
	transportDropWarning  = "Live container logs stream dropped one or more log entries due to client backlog. These lines were not intentionally filtered."
)

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

// NewHandler constructs a container logs stream handler.
func NewHandler(client kubernetes.Interface, logger Logger, recorder *telemetry.Recorder, limiters ...*GlobalTargetLimiter) (*Handler, error) {
	if client == nil {
		return nil, errors.New("containerlogsstream: kubernetes client is required")
	}
	var limiter *GlobalTargetLimiter
	if len(limiters) > 0 {
		limiter = limiters[0]
	}
	return &Handler{streamer: NewStreamer(client, logger, recorder), telemetry: recorder, limiter: limiter}, nil
}

// ServeHTTP implements http.Handler for the container logs streaming endpoint.
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	request, ok := h.prepareRequest(w, r)
	if !ok {
		return
	}
	request.serve()
}

type containerLogsHTTPRequest struct {
	handler  *Handler
	writer   http.ResponseWriter
	flusher  http.Flusher
	request  *http.Request
	options  Options
	stream   string
	target   string
	sequence uint64
}

func (h *Handler) prepareRequest(w http.ResponseWriter, r *http.Request) (*containerLogsHTTPRequest, bool) {
	if !applyCORS(w, r) {
		return nil, false
	}
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return nil, false
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		h.streamer.logger.Warn("containerlogsstream: response does not implement http.Flusher", logsources.ContainerLogsStream)
		http.Error(w, "streaming not supported", http.StatusInternalServerError)
		return nil, false
	}
	options, err := parseOptions(r)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return nil, false
	}
	return &containerLogsHTTPRequest{
		handler: h, writer: w, flusher: flusher, request: r, options: options,
		stream: telemetry.StreamContainerLogs, target: logTargetLabel(options), sequence: 1,
	}, true
}

func (s *containerLogsHTTPRequest) serve() {
	s.recordConnect()
	defer s.recordDisconnect()
	s.writeHeaders()
	if s.writeConnected() != nil {
		return
	}
	s.logDeadline()
	limiterSession := s.startLimiterSession()
	if limiterSession != nil {
		defer limiterSession.Release()
	}
	initial, ok := s.loadInitial(limiterSession)
	if !ok || s.writeInitial(initial) != nil {
		return
	}
	s.forward(initial, limiterSession)
}

func (s *containerLogsHTTPRequest) recordConnect() {
	if s.handler.telemetry != nil {
		s.handler.telemetry.RecordStreamConnect(s.stream)
	}
}

func (s *containerLogsHTTPRequest) recordDisconnect() {
	if s.handler.telemetry != nil {
		s.handler.telemetry.RecordStreamDisconnect(s.stream)
	}
}

func (s *containerLogsHTTPRequest) writeHeaders() {
	s.writer.Header().Set("Content-Type", "text/event-stream")
	s.writer.Header().Set("Cache-Control", "no-cache")
	s.writer.Header().Set("Connection", "keep-alive")
	s.writer.Header().Set("X-Accel-Buffering", "no")
	s.flusher.Flush()
}

func (s *containerLogsHTTPRequest) writeConnected() error {
	return s.writePayload(EventPayload{Reset: true, Entries: []Entry{}})
}

func (s *containerLogsHTTPRequest) writePayload(payload EventPayload) error {
	payload.Domain = containerLogsDomain
	payload.Scope = s.options.ScopeString
	payload.Sequence = s.sequence
	payload.GeneratedAt = time.Now().UnixMilli()
	s.sequence++
	return writeEvent(s.writer, s.flusher, payload)
}

func (s *containerLogsHTTPRequest) logDeadline() {
	if deadline, ok := s.request.Context().Deadline(); ok {
		s.handler.streamer.logger.Debug(fmt.Sprintf("containerlogsstream: client deadline %s", deadline.Format(time.RFC3339)), logsources.ContainerLogsStream)
	}
}

func (s *containerLogsHTTPRequest) startLimiterSession() *TargetSession {
	if s.handler.limiter == nil {
		return nil
	}
	return s.handler.limiter.StartSession(s.options.ClusterID, s.options.ScopeString)
}

type containerLogsInitial struct {
	entries        []Entry
	states         map[string]*containerState
	pods           []*corev1.Pod
	selector       string
	warnings       []string
	skippedTargets int
	skipReason     string
}

func (s *containerLogsHTTPRequest) loadInitial(limiterSession *TargetSession) (containerLogsInitial, bool) {
	entries, states, pods, selector, warnings, skipped, reason, err := s.handler.streamer.tail(
		s.request.Context(), s.options, limiterSession,
	)
	if err != nil {
		s.handleInitialError(err)
		return containerLogsInitial{}, false
	}
	if s.handler.telemetry != nil && skipped > 0 {
		s.handler.telemetry.RecordStreamSkippedTargets(s.stream, skipped, reason)
	}
	return containerLogsInitial{
		entries: entries, states: states, pods: pods, selector: selector,
		warnings: warnings, skippedTargets: skipped, skipReason: reason,
	}, true
}

func (s *containerLogsHTTPRequest) handleInitialError(err error) {
	s.recordError(err)
	s.handler.streamer.logger.Warn(fmt.Sprintf("containerlogsstream: initial tail failed: %v", err), logsources.ContainerLogsStream)
	status := permissionDeniedStatus(err)
	if status != nil {
		_ = s.writePayload(EventPayload{Error: err.Error(), ErrorDetails: status})
		return
	}
	http.Error(s.writer, err.Error(), http.StatusInternalServerError)
}

func (s *containerLogsHTTPRequest) writeInitial(initial containerLogsInitial) error {
	event := EventPayload{Reset: true, Entries: initial.entries, Warnings: warningPayload(initial.warnings, false)}
	if err := s.writePayload(event); err != nil {
		s.recordError(err)
		return err
	}
	if s.handler.telemetry != nil && len(initial.entries) > 0 {
		s.handler.telemetry.RecordStreamDeliveryForDomain(s.stream, s.target, len(initial.entries), 0)
	}
	return nil
}

func (s *containerLogsHTTPRequest) recordError(err error) {
	if s.handler.telemetry != nil {
		s.handler.telemetry.RecordStreamErrorForDomain(s.stream, s.target, err)
	}
}

type containerLogsStreamChannels struct {
	entries  chan Entry
	drops    chan int
	errors   chan error
	warnings chan []string
}

func newContainerLogsStreamChannels() containerLogsStreamChannels {
	return containerLogsStreamChannels{
		entries: make(chan Entry, 256), drops: make(chan int, 1024),
		errors: make(chan error, 1), warnings: make(chan []string, 8),
	}
}

func (s *containerLogsHTTPRequest) forward(initial containerLogsInitial, limiterSession *TargetSession) {
	channels := newContainerLogsStreamChannels()
	s.startRunner(initial, limiterSession, channels)
	keepAlive := time.NewTicker(config.ContainerLogsStreamKeepAliveInterval)
	defer keepAlive.Stop()
	heartbeat := time.NewTicker(config.StreamHeartbeatInterval)
	defer heartbeat.Stop()
	delivery := newContainerLogsDelivery(s, initial.warnings)
	defer delivery.stopBatchTimer()
	for {
		event := delivery.await(s.request.Context(), channels, keepAlive.C, heartbeat.C)
		if delivery.handle(event) {
			return
		}
	}
}

func (s *containerLogsHTTPRequest) startRunner(
	initial containerLogsInitial,
	limiterSession *TargetSession,
	channels containerLogsStreamChannels,
) {
	go func() {
		defer s.finishRunner(channels)
		s.handler.streamer.run(
			s.request.Context(), s.options, initial.pods, initial.selector, initial.states,
			limiterSession, initial.warnings, channels.entries, channels.warnings, channels.errors, channels.drops,
		)
	}()
}

func (s *containerLogsHTTPRequest) finishRunner(channels containerLogsStreamChannels) {
	if recovered := recover(); recovered != nil {
		applog.ReportPanic(s.handler.streamer.logger, recovered, "containerlogsstream: panic in stream handler", logsources.ContainerLogsStream)
		s.recordError(fmt.Errorf("panic: %v", recovered))
	}
	close(channels.entries)
	close(channels.drops)
	close(channels.warnings)
}

type containerLogsDeliveryEventKind uint8

const (
	containerLogsDeliveryCancelled containerLogsDeliveryEventKind = iota
	containerLogsDeliveryError
	containerLogsDeliveryWarnings
	containerLogsDeliveryWarningsClosed
	containerLogsDeliveryEntry
	containerLogsDeliveryEntriesClosed
	containerLogsDeliveryKeepAlive
	containerLogsDeliveryHeartbeat
	containerLogsDeliveryBatch
	containerLogsDeliveryDrop
	containerLogsDeliveryDropClosed
)

type containerLogsDeliveryEvent struct {
	kind     containerLogsDeliveryEventKind
	err      error
	warnings []string
	entry    Entry
	drop     int
}

type containerLogsDelivery struct {
	request               *containerLogsHTTPRequest
	batch                 []Entry
	batchTimer            *time.Timer
	pendingDropped        int
	selectionWarnings     []string
	emittedWarnings       []string
	transportDropObserved bool
	lastDelivery          time.Time
}

func newContainerLogsDelivery(request *containerLogsHTTPRequest, warnings []string) *containerLogsDelivery {
	return &containerLogsDelivery{
		request: request, selectionWarnings: append([]string(nil), warnings...),
		emittedWarnings: append([]string(nil), warnings...), lastDelivery: time.Now(),
	}
}

func (d *containerLogsDelivery) await(
	ctx context.Context,
	channels containerLogsStreamChannels,
	keepAlive <-chan time.Time,
	heartbeat <-chan time.Time,
) containerLogsDeliveryEvent {
	select {
	case <-ctx.Done():
		return containerLogsDeliveryEvent{kind: containerLogsDeliveryCancelled}
	case err := <-channels.errors:
		return containerLogsDeliveryEvent{kind: containerLogsDeliveryError, err: err}
	case warnings, ok := <-channels.warnings:
		if !ok {
			return containerLogsDeliveryEvent{kind: containerLogsDeliveryWarningsClosed}
		}
		return containerLogsDeliveryEvent{kind: containerLogsDeliveryWarnings, warnings: warnings}
	case entry, ok := <-channels.entries:
		if !ok {
			return containerLogsDeliveryEvent{kind: containerLogsDeliveryEntriesClosed}
		}
		return containerLogsDeliveryEvent{kind: containerLogsDeliveryEntry, entry: entry}
	case <-keepAlive:
		return containerLogsDeliveryEvent{kind: containerLogsDeliveryKeepAlive}
	case <-heartbeat:
		return containerLogsDeliveryEvent{kind: containerLogsDeliveryHeartbeat}
	case <-d.batchChannel():
		return containerLogsDeliveryEvent{kind: containerLogsDeliveryBatch}
	case drop, ok := <-channels.drops:
		if !ok {
			return containerLogsDeliveryEvent{kind: containerLogsDeliveryDropClosed}
		}
		return containerLogsDeliveryEvent{kind: containerLogsDeliveryDrop, drop: drop}
	}
}

func (d *containerLogsDelivery) batchChannel() <-chan time.Time {
	if d.batchTimer == nil {
		return nil
	}
	return d.batchTimer.C
}

func (d *containerLogsDelivery) handle(event containerLogsDeliveryEvent) bool {
	switch event.kind {
	case containerLogsDeliveryCancelled:
		d.flushBatch()
		return true
	case containerLogsDeliveryError:
		return d.handleError(event.err)
	case containerLogsDeliveryWarnings:
		return d.handleWarnings(event.warnings)
	case containerLogsDeliveryEntry:
		return d.handleEntry(event.entry)
	case containerLogsDeliveryEntriesClosed:
		return d.handleEntriesClosed()
	case containerLogsDeliveryKeepAlive:
		return d.handleKeepAlive()
	case containerLogsDeliveryHeartbeat:
		d.handleHeartbeat()
		return false
	case containerLogsDeliveryBatch:
		d.batchTimer = nil
		return d.flushBatch()
	case containerLogsDeliveryDrop:
		return d.handleDrop(event.drop)
	default:
		return false
	}
}

func (d *containerLogsDelivery) handleError(err error) bool {
	if err == nil {
		return false
	}
	payload := EventPayload{Error: err.Error(), ErrorDetails: permissionDeniedStatus(err)}
	if d.request.writePayload(payload) != nil {
		d.request.recordError(err)
		return true
	}
	d.request.recordError(err)
	return false
}

func (d *containerLogsDelivery) handleWarnings(warnings []string) bool {
	d.selectionWarnings = append(d.selectionWarnings[:0], warnings...)
	return d.emitWarningUpdate()
}

func (d *containerLogsDelivery) handleEntriesClosed() bool {
	d.flushBatch()
	if d.request.handler.telemetry != nil && d.pendingDropped > 0 {
		d.request.handler.telemetry.RecordStreamDeliveryForDomain(d.request.stream, d.request.target, 0, d.pendingDropped)
	}
	return true
}

func (d *containerLogsDelivery) handleEntry(entry Entry) bool {
	d.lastDelivery = time.Now()
	if d.batch == nil {
		d.batch = make([]Entry, 0, config.ContainerLogsStreamBatchMaxSize)
	}
	d.batch = append(d.batch, entry)
	if len(d.batch) >= config.ContainerLogsStreamBatchMaxSize {
		stop := d.flushBatch()
		d.stopBatchTimer()
		return stop
	}
	if d.batchTimer == nil {
		d.batchTimer = time.NewTimer(config.ContainerLogsStreamBatchWindow)
	}
	return false
}

func (d *containerLogsDelivery) handleKeepAlive() bool {
	if _, err := d.request.writer.Write([]byte(": keep-alive\n\n")); err != nil {
		d.request.recordError(err)
		return true
	}
	d.request.flusher.Flush()
	return false
}

func (d *containerLogsDelivery) handleHeartbeat() {
	if !shouldRecordHeartbeatTimeout(d.request.options.MatchNone, d.lastDelivery, time.Now()) {
		return
	}
	d.request.recordError(fmt.Errorf("containerlogsstream heartbeat timeout"))
	d.lastDelivery = time.Now()
}

func (d *containerLogsDelivery) handleDrop(drop int) bool {
	d.pendingDropped += drop
	if d.pendingDropped > 0 && !d.transportDropObserved && len(d.batch) == 0 {
		d.transportDropObserved = true
		if d.emitWarningUpdate() {
			return true
		}
	}
	if d.request.handler.telemetry != nil && len(d.batch) == 0 {
		d.request.handler.telemetry.RecordStreamDeliveryForDomain(
			d.request.stream, d.request.target, 0, d.pendingDropped,
		)
		d.pendingDropped = 0
	}
	return false
}

func (d *containerLogsDelivery) emitWarningUpdate() bool {
	nextWarnings := composeStreamWarnings(d.selectionWarnings, d.transportDropObserved)
	if stringSlicesEqual(d.emittedWarnings, nextWarnings) {
		return false
	}
	if d.request.writePayload(EventPayload{Warnings: warningPayload(nextWarnings, true)}) != nil {
		d.request.recordError(fmt.Errorf("containerlogsstream: failed to write warning update"))
		return true
	}
	d.emittedWarnings = append(d.emittedWarnings[:0], nextWarnings...)
	return false
}

func (d *containerLogsDelivery) flushBatch() bool {
	delivered := len(d.batch)
	if delivered == 0 && d.pendingDropped == 0 {
		return false
	}
	if delivered > 0 {
		entries := d.batch
		d.batch = nil
		if err := d.request.writePayload(EventPayload{Entries: entries}); err != nil {
			d.request.recordError(err)
			return true
		}
	}
	if d.request.handler.telemetry != nil {
		d.request.handler.telemetry.RecordStreamDeliveryForDomain(
			d.request.stream, d.request.target, delivered, d.pendingDropped,
		)
	}
	if d.pendingDropped > 0 && !d.transportDropObserved {
		d.transportDropObserved = true
		if d.emitWarningUpdate() {
			return true
		}
	}
	d.pendingDropped = 0
	d.lastDelivery = time.Now()
	return false
}

func (d *containerLogsDelivery) stopBatchTimer() {
	if d.batchTimer != nil {
		d.batchTimer.Stop()
		d.batchTimer = nil
	}
}

func shouldRecordHeartbeatTimeout(matchNone bool, lastDelivery, now time.Time) bool {
	return !matchNone && now.Sub(lastDelivery) > config.StreamHeartbeatTimeout
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
	copied := append([]string{}, warnings...)
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

// logTargetLabel identifies the object a log stream is tailing, so container-logs
// telemetry can be attributed per stream (one diagnostics row per open viewer).
func logTargetLabel(opts Options) string {
	target := opts.Namespace + "/" + opts.Name
	if opts.Container != "" {
		target += "/" + opts.Container
	}
	return target
}

func parseOptions(r *http.Request) (Options, error) {
	rawScope := strings.TrimSpace(r.URL.Query().Get("scope"))
	if rawScope == "" {
		return Options{}, errors.New("scope is required")
	}
	clusterIDs, _ := refresh.SplitClusterScopeList(rawScope)
	if len(clusterIDs) != 1 {
		return Options{}, errors.New("log scope requires a single cluster scope")
	}

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
	selectedFilters := trimQueryValues(r.URL.Query()["selectedFilter"])
	matchNone := strings.TrimSpace(r.URL.Query().Get("matchNone")) == "true"
	container := strings.TrimSpace(r.URL.Query().Get("container"))
	includeInit := parseBoolQueryWithDefault(r, "includeInit", true)
	includeEphemeral := parseBoolQueryWithDefault(r, "includeEphemeral", true)
	containerState, err := containerlogs.ParseContainerStateFilter(strings.TrimSpace(r.URL.Query().Get("containerState")))
	if err != nil {
		return Options{}, fmt.Errorf("invalid container state filter: %w", err)
	}
	include := strings.TrimSpace(r.URL.Query().Get("include"))
	exclude := strings.TrimSpace(r.URL.Query().Get("exclude"))
	tail := config.ContainerLogsStreamDefaultTailLines
	if rawTail := strings.TrimSpace(r.URL.Query().Get("tailLines")); rawTail != "" {
		if parsed, err := strconv.Atoi(rawTail); err == nil && parsed > 0 {
			tail = min(parsed, config.ContainerLogsStreamMaxTailLines)
		}
	}
	lineFilter, err := containerlogs.NewLineFilter(include, exclude)
	if err != nil {
		return Options{}, fmt.Errorf("invalid log filter: %w", err)
	}
	podNameFilter, err := containerlogs.NewPodNameFilter(podInclude, podExclude)
	if err != nil {
		return Options{}, fmt.Errorf("invalid pod filter: %w", err)
	}
	selection := containerlogs.ParseScopeSelection(selectedFilters)
	return Options{
		ClusterID: func() string {
			if len(clusterIDs) == 1 {
				return clusterIDs[0]
			}
			return ""
		}(),
		Namespace:        identity.Namespace,
		Group:            strings.TrimSpace(identity.GVK.Group),
		Version:          strings.TrimSpace(identity.GVK.Version),
		Kind:             strings.ToLower(strings.TrimSpace(identity.GVK.Kind)),
		Name:             strings.TrimSpace(identity.Name),
		PodFilter:        podFilter,
		PodInclude:       podInclude,
		PodExclude:       podExclude,
		SelectedFilters:  selectedFilters,
		MatchNone:        matchNone,
		Selection:        selection,
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

func trimQueryValues(values []string) []string {
	if len(values) == 0 {
		return nil
	}
	trimmed := make([]string, 0, len(values))
	for _, value := range values {
		next := strings.TrimSpace(value)
		if next == "" {
			continue
		}
		trimmed = append(trimmed, next)
	}
	return trimmed
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
			domain:   containerLogsDomain,
			resource: logPermissionResource,
			message:  err.Error(),
		}
		if status, ok := refresh.PermissionDeniedStatusFromError(wrapped); ok {
			return status
		}
	}
	return nil
}
