package containerlogsstream

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
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

// Handler serves pod/workload logs over a named Wails stream.
type Handler struct {
	streamer    *Streamer
	telemetry   *telemetry.Recorder
	limiter     *GlobalTargetLimiter
	sessionsMu  sync.Mutex
	nextSession uint64
	sessions    map[uint64]context.CancelFunc
	stopped     bool
}

// JSONSender is the transport-neutral JSON sender used by container logs.
// Wails' StreamConn implements this interface directly.
type JSONSender interface {
	SendJSON(v interface{}) error
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
	return NewHandlerWithLimits(client, logger, recorder, containerlogs.DefaultPerScopeTargetLimit, limiters...)
}

func NewHandlerWithLimits(client kubernetes.Interface, logger Logger, recorder *telemetry.Recorder, perScopeLimit int, limiters ...*GlobalTargetLimiter) (*Handler, error) {
	if client == nil {
		return nil, errors.New("containerlogsstream: kubernetes client is required")
	}
	var limiter *GlobalTargetLimiter
	if len(limiters) > 0 {
		limiter = limiters[0]
	}
	return &Handler{
		streamer: NewStreamer(client, logger, recorder, perScopeLimit), telemetry: recorder, limiter: limiter,
		sessions: make(map[uint64]context.CancelFunc),
	}, nil
}

type containerLogsStream struct {
	handler  *Handler
	conn     JSONSender
	options  Options
	stream   string
	target   string
	sequence uint64
}

// Handle serves one already-routed named-stream request.
func (h *Handler) Handle(ctx context.Context, conn JSONSender, request Request) {
	options, err := parseRequest(request)
	if err != nil {
		_ = conn.SendJSON(EventPayload{
			Domain: containerLogsDomain, Scope: strings.TrimSpace(request.Scope),
			Sequence: 1, GeneratedAt: time.Now().UnixMilli(), Error: err.Error(),
		})
		return
	}
	ctx, cancel := context.WithCancel(ctx)
	h.sessionsMu.Lock()
	if h.stopped {
		h.sessionsMu.Unlock()
		cancel()
		return
	}
	h.nextSession++
	sessionID := h.nextSession
	h.sessions[sessionID] = cancel
	h.sessionsMu.Unlock()
	defer func() {
		cancel()
		h.sessionsMu.Lock()
		delete(h.sessions, sessionID)
		h.sessionsMu.Unlock()
	}()
	stream := &containerLogsStream{
		handler: h, conn: conn, options: options,
		stream: telemetry.StreamContainerLogs, target: logTargetLabel(options), sequence: 1,
	}
	stream.serve(ctx)
}

// Stop ends every active stream owned by this per-cluster handler generation.
func (h *Handler) Stop() {
	if h == nil {
		return
	}
	h.sessionsMu.Lock()
	h.stopped = true
	cancels := make([]context.CancelFunc, 0, len(h.sessions))
	for _, cancel := range h.sessions {
		cancels = append(cancels, cancel)
	}
	h.sessionsMu.Unlock()
	for _, cancel := range cancels {
		cancel()
	}
}

func (s *containerLogsStream) serve(ctx context.Context) {
	s.recordConnect()
	defer s.recordDisconnect()
	if s.writeConnected() != nil {
		return
	}
	s.logDeadline(ctx)
	limiterSession := s.startLimiterSession()
	if limiterSession != nil {
		defer limiterSession.Release()
	}
	initial, ok := s.loadInitial(ctx, limiterSession)
	if !ok || s.writeInitial(initial) != nil {
		return
	}
	s.forward(ctx, initial, limiterSession)
}

func (s *containerLogsStream) recordConnect() {
	if s.handler.telemetry != nil {
		s.handler.telemetry.RecordStreamConnect(s.stream)
	}
}

func (s *containerLogsStream) recordDisconnect() {
	if s.handler.telemetry != nil {
		s.handler.telemetry.RecordStreamDisconnect(s.stream)
	}
}

func (s *containerLogsStream) writeConnected() error {
	return s.writePayload(EventPayload{Reset: true, Entries: []Entry{}})
}

func (s *containerLogsStream) writePayload(payload EventPayload) error {
	payload.Domain = containerLogsDomain
	payload.Scope = s.options.ScopeString
	payload.Sequence = s.sequence
	payload.GeneratedAt = time.Now().UnixMilli()
	s.sequence++
	return s.conn.SendJSON(payload)
}

func (s *containerLogsStream) logDeadline(ctx context.Context) {
	if deadline, ok := ctx.Deadline(); ok {
		s.handler.streamer.logger.Debug(fmt.Sprintf("containerlogsstream: client deadline %s", deadline.Format(time.RFC3339)), logsources.ContainerLogsStream)
	}
}

func (s *containerLogsStream) startLimiterSession() *TargetSession {
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

func (s *containerLogsStream) loadInitial(ctx context.Context, limiterSession *TargetSession) (containerLogsInitial, bool) {
	entries, states, pods, selector, warnings, skipped, reason, err := s.handler.streamer.tail(
		ctx, s.options, limiterSession,
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

func (s *containerLogsStream) handleInitialError(err error) {
	s.recordError(err)
	s.handler.streamer.logger.Warn(fmt.Sprintf("containerlogsstream: initial tail failed: %v", err), logsources.ContainerLogsStream)
	_ = s.writePayload(EventPayload{Error: err.Error(), ErrorDetails: permissionDeniedStatus(err)})
}

func (s *containerLogsStream) writeInitial(initial containerLogsInitial) error {
	event := EventPayload{Reset: true, Entries: initial.entries, Warnings: warningPayload(initial.warnings, false)}
	if err := s.writePayload(event); err != nil {
		s.recordError(err)
		return err
	}
	if s.handler.telemetry != nil && len(initial.entries) > 0 {
		s.handler.telemetry.RecordStreamDeliveryForLeaf(s.stream, telemetry.TargetLeaf(s.target), len(initial.entries), 0)
	}
	return nil
}

func (s *containerLogsStream) recordError(err error) {
	if s.handler.telemetry != nil {
		s.handler.telemetry.RecordStreamErrorForLeaf(s.stream, telemetry.TargetLeaf(s.target), err)
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

func (s *containerLogsStream) forward(ctx context.Context, initial containerLogsInitial, limiterSession *TargetSession) {
	channels := newContainerLogsStreamChannels()
	s.startRunner(ctx, initial, limiterSession, channels)
	heartbeat := time.NewTicker(config.StreamHeartbeatInterval)
	defer heartbeat.Stop()
	delivery := newContainerLogsDelivery(s, initial.warnings)
	defer delivery.stopBatchTimer()
	for {
		event := delivery.await(ctx, channels, heartbeat.C)
		if delivery.handle(event) {
			return
		}
	}
}

func (s *containerLogsStream) startRunner(
	ctx context.Context,
	initial containerLogsInitial,
	limiterSession *TargetSession,
	channels containerLogsStreamChannels,
) {
	go func() {
		defer s.finishRunner(channels)
		s.handler.streamer.run(
			ctx, initial.pods, initial.selector, containerLogRunConfig{opts: s.options, states: initial.states, limiterSession: limiterSession, initialWarnings: initial.warnings, entriesCh: channels.entries, warningsCh: channels.warnings, errCh: channels.errors, dropCh: channels.drops})

	}()
}

func (s *containerLogsStream) finishRunner(channels containerLogsStreamChannels) {
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
	request               *containerLogsStream
	batch                 []Entry
	batchTimer            *time.Timer
	pendingDropped        int
	selectionWarnings     []string
	emittedWarnings       []string
	transportDropObserved bool
	lastDelivery          time.Time
}

func newContainerLogsDelivery(request *containerLogsStream, warnings []string) *containerLogsDelivery {
	return &containerLogsDelivery{
		request: request, selectionWarnings: append([]string(nil), warnings...),
		emittedWarnings: append([]string(nil), warnings...), lastDelivery: time.Now(),
	}
}

func (d *containerLogsDelivery) await(
	ctx context.Context,
	channels containerLogsStreamChannels,
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
		d.request.handler.telemetry.RecordStreamDeliveryForLeaf(d.request.stream, telemetry.TargetLeaf(d.request.target), 0, d.pendingDropped)
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
		d.request.handler.telemetry.RecordStreamDeliveryForLeaf(
			d.request.stream, telemetry.TargetLeaf(d.request.target), 0, d.pendingDropped,
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
		d.request.handler.telemetry.RecordStreamDeliveryForLeaf(
			d.request.stream, telemetry.TargetLeaf(d.request.target), delivered, d.pendingDropped,
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

// logTargetLabel identifies the object a log stream is tailing, so container-logs
// telemetry can be attributed per stream (one diagnostics row per open viewer).
func logTargetLabel(opts Options) string {
	target := opts.Namespace + "/" + opts.Name
	if opts.Container != "" {
		target += "/" + opts.Container
	}
	return target
}

func parseRequest(request Request) (Options, error) {
	rawScope := strings.TrimSpace(request.Scope)
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
	podFilter := strings.TrimSpace(request.Pod)
	podInclude := strings.TrimSpace(request.PodInclude)
	podExclude := strings.TrimSpace(request.PodExclude)
	selectedFilters := trimQueryValues(request.SelectedFilters)
	container := strings.TrimSpace(request.Container)
	includeInit := true
	if request.IncludeInit != nil {
		includeInit = *request.IncludeInit
	}
	includeEphemeral := true
	if request.IncludeEphemeral != nil {
		includeEphemeral = *request.IncludeEphemeral
	}
	containerState, err := containerlogs.ParseContainerStateFilter(strings.TrimSpace(request.ContainerState))
	if err != nil {
		return Options{}, fmt.Errorf("invalid container state filter: %w", err)
	}
	include := strings.TrimSpace(request.Include)
	exclude := strings.TrimSpace(request.Exclude)
	tail := config.ContainerLogsStreamDefaultTailLines
	if request.TailLines > 0 {
		tail = min(request.TailLines, config.ContainerLogsStreamMaxTailLines)
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
		MatchNone:        request.MatchNone,
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
