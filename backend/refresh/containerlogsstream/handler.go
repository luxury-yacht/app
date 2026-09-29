package containerlogsstream

import (
	"context"
	"errors"
	"fmt"
	"slices"
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
	if !ok {
		return
	}
	s.run(ctx, initial, limiterSession)
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
	pods           []*corev1.Pod
	watch          *containerlogs.PodWatch
	warnings       []string
	skippedTargets int
	skipReason     string
}

func (s *containerLogsStream) loadInitial(ctx context.Context, limiterSession *TargetSession) (containerLogsInitial, bool) {
	initial, err := s.handler.streamer.prepare(ctx, s.options, limiterSession)
	if err != nil {
		s.handleInitialError(err)
		return containerLogsInitial{}, false
	}
	if s.handler.telemetry != nil && initial.skippedTargets > 0 {
		s.handler.telemetry.RecordStreamSkippedTargets(s.stream, initial.skippedTargets, initial.skipReason)
	}
	return initial, true
}

func (s *containerLogsStream) handleInitialError(err error) {
	s.recordError(err)
	s.handler.streamer.logger.Warn(fmt.Sprintf("containerlogsstream: initial resolve failed: %v", err), logsources.ContainerLogsStream)
	_ = s.writePayload(EventPayload{Error: err.Error(), ErrorDetails: permissionDeniedStatus(err)})
}

func (s *containerLogsStream) recordError(err error) {
	if s.handler.telemetry != nil {
		s.handler.telemetry.RecordStreamErrorForLeaf(s.stream, telemetry.TargetLeaf(s.target), err)
	}
}

// run starts the session's followers and sends what they read: one snapshot of
// the containers' history, then live batches.
func (s *containerLogsStream) run(ctx context.Context, initial containerLogsInitial, limiterSession *TargetSession) {
	pending := newPendingEntries(config.ContainerLogsStreamPendingMaxEntries, config.ContainerLogsStreamPendingMaxBytes)
	snapshot := newSnapshotWait()
	errs := make(chan error, 1)
	warnings := make(chan []string, 8)
	runnerDone := s.startRunner(ctx, initial, containerLogRunConfig{
		opts: s.options, limiterSession: limiterSession,
		initialWarnings: initial.warnings, sink: pending, snapshot: snapshot, warningsCh: warnings, errCh: errs,
	})
	delivery := newContainerLogsDelivery(s, pending, initial.warnings)
	if !delivery.sendSnapshot(ctx, snapshot.done, runnerDone, warnings) {
		return
	}
	delivery.forward(ctx, runnerDone, errs, warnings)
}

func (s *containerLogsStream) startRunner(ctx context.Context, initial containerLogsInitial, config containerLogRunConfig) <-chan struct{} {
	done := make(chan struct{})
	go func() {
		defer close(done)
		defer s.recoverRunner()
		s.handler.streamer.run(ctx, initial.pods, initial.watch, config)
	}()
	return done
}

func (s *containerLogsStream) recoverRunner() {
	if recovered := recover(); recovered != nil {
		applog.ReportPanic(s.handler.streamer.logger, recovered, "containerlogsstream: panic in stream handler", logsources.ContainerLogsStream)
		s.recordError(fmt.Errorf("panic: %v", recovered))
	}
}

// containerLogsDelivery sends a session's pending entries, errors and warning
// updates to the client.
type containerLogsDelivery struct {
	request               *containerLogsStream
	pending               *pendingEntries
	batchTimer            *time.Timer
	selectionWarnings     []string
	emittedWarnings       []string
	transportDropObserved bool
}

func newContainerLogsDelivery(request *containerLogsStream, pending *pendingEntries, warnings []string) *containerLogsDelivery {
	return &containerLogsDelivery{
		request: request, pending: pending, selectionWarnings: append([]string(nil), warnings...),
		emittedWarnings: append([]string(nil), warnings...),
	}
}

// sendSnapshot waits until the initial followers have delivered their history,
// or the snapshot deadline passes, and sends it as the reset frame.
func (d *containerLogsDelivery) sendSnapshot(ctx context.Context, ready, runnerDone <-chan struct{}, warnings <-chan []string) bool {
	deadline := time.NewTimer(config.ContainerLogsStreamSnapshotDeadline)
	defer deadline.Stop()
	for {
		select {
		case <-ctx.Done():
			return false
		case next := <-warnings:
			d.selectionWarnings = append(d.selectionWarnings[:0], next...)
		case <-ready:
			return d.writeSnapshot()
		case <-deadline.C:
			return d.writeSnapshot()
		case <-runnerDone:
			return d.writeSnapshot()
		}
	}
}

func (d *containerLogsDelivery) writeSnapshot() bool {
	entries, dropped := d.pending.take()
	containerlogs.SortByTimestamp(entries, entryTimestamp)
	if dropped > 0 {
		d.transportDropObserved = true
	}
	warnings := composeStreamWarnings(d.selectionWarnings, d.transportDropObserved)
	if err := d.request.writePayload(EventPayload{Reset: true, Entries: entries, Warnings: warningPayload(warnings, false)}); err != nil {
		d.request.recordError(err)
		return false
	}
	d.emittedWarnings = append(d.emittedWarnings[:0], warnings...)
	d.recordDelivery(len(entries), dropped)
	return true
}

func (d *containerLogsDelivery) forward(ctx context.Context, runnerDone <-chan struct{}, errs <-chan error, warnings <-chan []string) {
	defer d.stopBatchTimer()
	if d.pending.size() > 0 {
		d.armBatch()
	}
	for !d.step(ctx, runnerDone, errs, warnings) {
	}
}

// step handles one event and reports whether the session is over.
func (d *containerLogsDelivery) step(ctx context.Context, runnerDone <-chan struct{}, errs <-chan error, warnings <-chan []string) bool {
	select {
	case <-ctx.Done():
		d.flush()
		return true
	case <-runnerDone:
		d.flush()
		return true
	case err := <-errs:
		return d.handleError(err)
	case next := <-warnings:
		return d.handleWarnings(next)
	case <-d.pending.notify:
		return d.onPending()
	case <-d.batchChannel():
		d.batchTimer = nil
		return d.flush()
	}
}

// onPending sends a full batch at once and otherwise waits one batch window
// so nearby lines share a frame.
func (d *containerLogsDelivery) onPending() bool {
	if d.pending.size() >= config.ContainerLogsStreamBatchMaxSize {
		return d.flush()
	}
	d.armBatch()
	return false
}

func (d *containerLogsDelivery) armBatch() {
	if d.batchTimer == nil {
		d.batchTimer = time.NewTimer(config.ContainerLogsStreamBatchWindow)
	}
}

func (d *containerLogsDelivery) batchChannel() <-chan time.Time {
	if d.batchTimer == nil {
		return nil
	}
	return d.batchTimer.C
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

func (d *containerLogsDelivery) emitWarningUpdate() bool {
	nextWarnings := composeStreamWarnings(d.selectionWarnings, d.transportDropObserved)
	if slices.Equal(d.emittedWarnings, nextWarnings) {
		return false
	}
	if d.request.writePayload(EventPayload{Warnings: warningPayload(nextWarnings, true)}) != nil {
		d.request.recordError(fmt.Errorf("containerlogsstream: failed to write warning update"))
		return true
	}
	d.emittedWarnings = append(d.emittedWarnings[:0], nextWarnings...)
	return false
}

// flush sends every pending entry in frames of at most the batch size. It
// returns true when the client can no longer be written to.
func (d *containerLogsDelivery) flush() bool {
	d.stopBatchTimer()
	entries, dropped := d.pending.take()
	for start := 0; start < len(entries); start += config.ContainerLogsStreamBatchMaxSize {
		end := min(start+config.ContainerLogsStreamBatchMaxSize, len(entries))
		if err := d.request.writePayload(EventPayload{Entries: entries[start:end]}); err != nil {
			d.request.recordError(err)
			return true
		}
	}
	d.recordDelivery(len(entries), dropped)
	if dropped > 0 && !d.transportDropObserved {
		d.transportDropObserved = true
		return d.emitWarningUpdate()
	}
	return false
}

func (d *containerLogsDelivery) recordDelivery(delivered, dropped int) {
	if d.request.handler.telemetry != nil && (delivered > 0 || dropped > 0) {
		d.request.handler.telemetry.RecordStreamDeliveryForLeaf(
			d.request.stream, telemetry.TargetLeaf(d.request.target), delivered, dropped,
		)
	}
}

func (d *containerLogsDelivery) stopBatchTimer() {
	if d.batchTimer != nil {
		d.batchTimer.Stop()
		d.batchTimer = nil
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
	copied := append([]string{}, warnings...)
	return &copied
}

// logTargetLabel identifies the object a log stream is tailing, so container-logs
// telemetry can be attributed per stream (one diagnostics row per open viewer).
func logTargetLabel(opts Options) string {
	return opts.Namespace + "/" + opts.Name
}

func parseRequest(request Request) (Options, error) {
	rawScope := strings.TrimSpace(request.Scope)
	identity, err := containerlogs.ParseTargetScope(rawScope)
	if err != nil {
		return Options{}, err
	}
	clusterIDs, _ := refresh.SplitClusterScopeList(rawScope)
	if len(clusterIDs) != 1 {
		return Options{}, errors.New("log scope requires a single cluster scope")
	}
	tail := config.ContainerLogsStreamDefaultTailLines
	if request.TailLines > 0 {
		tail = min(request.TailLines, config.ContainerLogsStreamMaxTailLines)
	}
	return Options{
		ClusterID: clusterIDs[0],
		Namespace: identity.Namespace,
		Group:     identity.GVK.Group,
		Version:   identity.GVK.Version,
		Kind:      strings.ToLower(identity.GVK.Kind),
		Name:      identity.Name,
		MatchNone: request.MatchNone,
		Selection: containerlogs.ParseScopeSelection(request.SelectedFilters),
		TailLines: tail,
		// Keep the original scope for client-side keying.
		ScopeString: rawScope,
	}, nil
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
