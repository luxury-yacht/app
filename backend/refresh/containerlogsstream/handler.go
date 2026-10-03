package containerlogsstream

import (
	"context"
	"encoding/json"
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

const containerLogsDomain = "container-logs"

// frameBudgetBytes bounds the encoded entries in one frame. It is derived from
// the line limit so one frame always holds the longest line, even after JSON
// escaping multiplies its size.
const frameBudgetBytes = 8 * containerlogs.MaxLineBytes

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
	warnings       []containerlogs.Warning
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
	s.handler.streamer.logger.Warn(fmt.Sprintf("containerlogsstream: initial resolve failed: %v", err), logsources.ContainerLogsStream)
	s.writeFatal(err)
}

// writeFatal sends the error that ends the session.
func (s *containerLogsStream) writeFatal(err error) {
	s.recordError(err)
	_ = s.writePayload(EventPayload{Error: err.Error(), ErrorDetails: permissionDeniedStatus(err), Retryable: isRetryable(err)})
}

// isRetryable reports whether reconnecting could fix a failure. A missing
// object, a permission denial or a rejected request stays failed.
func isRetryable(err error) bool {
	return !apierrors.IsNotFound(err) && !apierrors.IsForbidden(err) &&
		!apierrors.IsBadRequest(err) && !apierrors.IsInvalid(err)
}

func (s *containerLogsStream) recordError(err error) {
	if s.handler.telemetry != nil {
		s.handler.telemetry.RecordStreamErrorForLeaf(s.stream, telemetry.TargetLeaf(s.target), err)
	}
}

// run starts the session's followers and sends what they read: one snapshot of
// the containers' history, then live batches.
func (s *containerLogsStream) run(ctx context.Context, initial containerLogsInitial, limiterSession *TargetSession) {
	pending := newPendingEntries(config.ContainerLogsStreamPendingMaxEntries, config.ContainerLogsStreamPendingMaxBytes).
		collectHistory(s.options.MaxEntries, s.options.MaxBytes)
	snapshot := newSnapshotWait()
	sent := newSentLines(s.options.MaxEntries, s.options.MaxBytes)
	issues := newIssueSet()
	warnings := newWarningUpdates()
	removed := make(chan string, 16)
	fatal := make(chan error, 1)
	runnerDone := s.startRunner(ctx, initial, containerLogRunConfig{
		opts: s.options, limiterSession: limiterSession, initialWarnings: initial.warnings,
		sink: pending, snapshot: snapshot, warnings: warnings, issues: issues, sent: sent, removed: removed, fatal: fatal,
	})
	delivery := newContainerLogsDelivery(s, pending, issues, initial.warnings)
	delivery.sent = sent
	delivery.removedPods = absentResumedPods(s.options.Resume, initial.pods)
	events := deliveryEvents{runnerDone: runnerDone, warnings: warnings, removed: removed, fatal: fatal}
	if !delivery.sendSnapshot(ctx, snapshot.done, events) {
		return
	}
	delivery.forward(ctx, events)
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

// deliveryEvents are the runner's signals to the delivery loop.
type deliveryEvents struct {
	runnerDone <-chan struct{}
	warnings   *warningUpdates
	removed    <-chan string
	fatal      <-chan error
}

// containerLogsDelivery sends a session's pending entries, warning and issue
// updates, and a fatal error if one ends the session.
type containerLogsDelivery struct {
	request *containerLogsStream
	pending *pendingEntries
	issues  *issueSet
	// sent records every line sent, so history reads skip what the client
	// could not keep.
	sent *sentLines
	// removedPods are the resumed pods that no longer exist.
	removedPods       []string
	batchTimer        *time.Timer
	selectionWarnings []containerlogs.Warning
	emittedWarnings   []containerlogs.Warning
	emittedIssues     []containerlogs.TargetIssue
	dropped           int
}

func newContainerLogsDelivery(request *containerLogsStream, pending *pendingEntries, issues *issueSet, warnings []containerlogs.Warning) *containerLogsDelivery {
	return &containerLogsDelivery{
		request: request, pending: pending, issues: issues,
		selectionWarnings: append([]containerlogs.Warning(nil), warnings...),
	}
}

// sendSnapshot waits until the initial followers have delivered their history,
// or the snapshot deadline passes, and sends it.
func (d *containerLogsDelivery) sendSnapshot(ctx context.Context, ready <-chan struct{}, events deliveryEvents) bool {
	deadline := time.NewTimer(config.ContainerLogsStreamSnapshotDeadline)
	defer deadline.Stop()
	for {
		select {
		case <-ctx.Done():
			return false
		case <-events.warnings.notify:
			d.selectionWarnings = append(d.selectionWarnings[:0], events.warnings.take()...)
		case err := <-events.fatal:
			d.request.writeFatal(err)
			return false
		case <-ready:
			return d.writeSnapshot()
		case <-deadline.C:
			return d.writeSnapshot()
		case <-events.runnerDone:
			return d.writeSnapshot()
		}
	}
}

// writeSnapshot sends the newest history the client can hold, in time order,
// as frames within the frame budget. The first frame resets the client and
// carries the warnings and issues; the last completes the snapshot.
func (d *containerLogsDelivery) writeSnapshot() bool {
	kept, trimmed, dropped := d.pending.takeSnapshot()
	d.dropped += dropped
	warnings, issues := d.currentWarnings(), d.issues.list()
	frames := splitFrames(kept, 0)
	if len(frames) == 0 {
		frames = [][]Entry{nil}
	}
	for i, frame := range frames {
		payload := EventPayload{Entries: frame, Reset: i == 0, SnapshotComplete: i == len(frames)-1}
		if payload.Reset {
			payload.Resumed = len(d.request.options.Resume) > 0
			payload.RemovedPods = d.removedPods
			payload.Warnings, payload.Issues = listPayload(warnings, false), listPayload(issues, false)
		}
		if payload.SnapshotComplete {
			payload.Trimmed = trimmed
		}
		if err := d.request.writePayload(payload); err != nil {
			d.request.recordError(err)
			return false
		}
	}
	d.sent.add(kept)
	d.emittedWarnings, d.emittedIssues = warnings, issues
	d.recordDelivery(len(kept), dropped)
	return true
}

// splitFrames groups entries into frames whose encoded size fits the frame
// budget and, when maxCount is positive, that hold at most maxCount entries.
func splitFrames(entries []Entry, maxCount int) [][]Entry {
	var frames [][]Entry
	start, size := 0, 0
	for i, entry := range entries {
		entrySize := encodedEntrySize(entry)
		full := i > start && (size+entrySize > frameBudgetBytes || (maxCount > 0 && i-start >= maxCount))
		if full {
			frames = append(frames, entries[start:i])
			start, size = i, 0
		}
		size += entrySize
	}
	if start < len(entries) {
		frames = append(frames, entries[start:])
	}
	return frames
}

// encodedEntrySize is the entry's size on the wire.
func encodedEntrySize(entry Entry) int {
	encoded, err := json.Marshal(entry)
	if err != nil {
		return len(entry.Line)
	}
	return len(encoded)
}

func (d *containerLogsDelivery) forward(ctx context.Context, events deliveryEvents) {
	defer d.stopBatchTimer()
	if count, _ := d.pending.size(); count > 0 {
		d.armBatch()
	}
	for !d.step(ctx, events) {
	}
}

// step handles one event and reports whether the session is over.
func (d *containerLogsDelivery) step(ctx context.Context, events deliveryEvents) bool {
	select {
	case <-ctx.Done():
		d.flush()
		return true
	case <-events.runnerDone:
		d.flush()
		return true
	case err := <-events.fatal:
		d.flush()
		d.request.writeFatal(err)
		return true
	case <-events.warnings.notify:
		d.selectionWarnings = append(d.selectionWarnings[:0], events.warnings.take()...)
		return d.emitWarningUpdate()
	case name := <-events.removed:
		return d.emitRemoval(name)
	case <-d.issues.notify:
		return d.emitIssueUpdate()
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
	if count, bytes := d.pending.size(); count >= config.ContainerLogsStreamBatchMaxSize || bytes >= frameBudgetBytes {
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

// currentWarnings is the selection warnings plus, once entries were lost, one
// dropped warning with the session's total.
func (d *containerLogsDelivery) currentWarnings() []containerlogs.Warning {
	warnings := append([]containerlogs.Warning(nil), d.selectionWarnings...)
	if d.dropped > 0 {
		warnings = append(warnings, containerlogs.Warning{Kind: containerlogs.WarningDropped, Count: d.dropped})
	}
	return warnings
}

func (d *containerLogsDelivery) emitWarningUpdate() bool {
	next := d.currentWarnings()
	if slices.Equal(d.emittedWarnings, next) {
		return false
	}
	if d.request.writePayload(EventPayload{Warnings: listPayload(next, true)}) != nil {
		d.request.recordError(fmt.Errorf("containerlogsstream: failed to write warning update"))
		return true
	}
	d.emittedWarnings = next
	return false
}

func (d *containerLogsDelivery) emitIssueUpdate() bool {
	next := d.issues.list()
	if slices.Equal(d.emittedIssues, next) {
		return false
	}
	if d.request.writePayload(EventPayload{Issues: listPayload(next, true)}) != nil {
		d.request.recordError(fmt.Errorf("containerlogsstream: failed to write issue update"))
		return true
	}
	d.emittedIssues = next
	return false
}

// emitRemoval tells the client to drop a removed pod's lines, after sending
// any of them still pending so none arrive later.
func (d *containerLogsDelivery) emitRemoval(pod string) bool {
	if d.flush() {
		return true
	}
	if err := d.request.writePayload(EventPayload{RemovedPods: []string{pod}}); err != nil {
		d.request.recordError(err)
		return true
	}
	d.sent.dropPod(pod)
	return false
}

// flush sends every pending entry in frames bounded by count and bytes. It
// returns true when the client can no longer be written to.
func (d *containerLogsDelivery) flush() bool {
	d.stopBatchTimer()
	entries, dropped := d.pending.take()
	for _, frame := range splitFrames(entries, config.ContainerLogsStreamBatchMaxSize) {
		if err := d.request.writePayload(EventPayload{Entries: frame}); err != nil {
			d.request.recordError(err)
			return true
		}
		d.sent.add(frame)
	}
	d.recordDelivery(len(entries), dropped)
	if dropped > 0 {
		d.dropped += dropped
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

// listPayload encodes a replacement list. An empty list is sent only when it
// clears an earlier one.
func listPayload[T any](items []T, includeEmpty bool) *[]T {
	if len(items) == 0 && !includeEmpty {
		return nil
	}
	copied := append([]T{}, items...)
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
	maxEntries := config.ContainerLogsStreamDefaultTailLines
	if request.MaxEntries > 0 {
		maxEntries = min(request.MaxEntries, config.ContainerLogsStreamMaxTailLines)
	}
	maxBytes := config.ContainerLogsStreamMaxBytes
	if request.MaxBytes > 0 {
		// Every line must fit, so the limit is never below one line.
		maxBytes = min(max(request.MaxBytes, containerlogs.MaxLineBytes), config.ContainerLogsStreamMaxBytes)
	}
	return Options{
		ClusterID:  clusterIDs[0],
		Namespace:  identity.Namespace,
		Group:      identity.GVK.Group,
		Version:    identity.GVK.Version,
		Kind:       strings.ToLower(identity.GVK.Kind),
		Name:       identity.Name,
		MatchNone:  request.MatchNone,
		Selection:  containerlogs.ParseScopeSelection(request.SelectedFilters),
		MaxEntries: maxEntries,
		MaxBytes:   maxBytes,
		Resume:     resumeTargets(identity.Namespace, request.Resume),
		// Keep the original scope for client-side keying.
		ScopeString: rawScope,
	}, nil
}

// absentResumedPods names the pods the client resumed that the session did not
// find: they ended while the client was away. A pod recreated with the same
// name is found and not named.
func absentResumedPods(resume []containerTarget, pods []*corev1.Pod) []string {
	present := make(map[string]struct{}, len(pods))
	for _, pod := range pods {
		if pod != nil {
			present[pod.Name] = struct{}{}
		}
	}
	var absent []string
	for _, target := range resume {
		if _, found := present[target.pod]; !found {
			present[target.pod] = struct{}{}
			absent = append(absent, target.pod)
		}
	}
	return absent
}

// resumeTargets turns the client's resume points into cursors. If any point is
// unusable none are used: that container would read its history again and
// duplicate lines the client keeps.
func resumeTargets(namespace string, points []ResumePoint) []containerTarget {
	targets := make([]containerTarget, 0, len(points))
	for _, point := range points {
		at, err := time.Parse(time.RFC3339Nano, point.Timestamp)
		if err != nil || point.Pod == "" || point.Container == "" || len(point.Lines) == 0 {
			return nil
		}
		target := containerTarget{
			namespace: namespace, pod: point.Pod, container: point.Container,
			isInit: point.IsInit, isEphemeral: point.IsEphemeral,
		}
		for _, line := range point.Lines {
			target.cursor.Observe(at, line)
		}
		targets = append(targets, target)
	}
	return targets
}

// permissionDeniedStatus translates forbidden errors into Status-like payloads
// that name the denied API resource.
func permissionDeniedStatus(err error) *refresh.PermissionDeniedStatus {
	if status, ok := refresh.PermissionDeniedStatusFromError(err); ok {
		return status
	}
	if apierrors.IsForbidden(err) {
		wrapped := permissionDeniedError{
			domain:   containerLogsDomain,
			resource: forbiddenResource(err),
			message:  err.Error(),
		}
		if status, ok := refresh.PermissionDeniedStatusFromError(wrapped); ok {
			return status
		}
	}
	return nil
}

// forbiddenResource names the API resource a Forbidden error denied, such as
// core/pods; the error message names the verb.
func forbiddenResource(err error) string {
	var status apierrors.APIStatus
	if !errors.As(err, &status) {
		return ""
	}
	details := status.Status().Details
	if details == nil || details.Kind == "" {
		return ""
	}
	group := details.Group
	if group == "" {
		group = "core"
	}
	return group + "/" + details.Kind
}
