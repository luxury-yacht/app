package containerlogsstream

import (
	"context"
	"errors"
	"fmt"
	"io"
	"sort"
	"strings"
	"sync"
	"time"

	cronjobpkg "github.com/luxury-yacht/app/backend/resources/cronjob"
	jobpkg "github.com/luxury-yacht/app/backend/resources/job"

	"github.com/luxury-yacht/app/backend/internal/applog"
	"github.com/luxury-yacht/app/backend/internal/containerlogs"
	"github.com/luxury-yacht/app/backend/internal/linescanner"
	"github.com/luxury-yacht/app/backend/internal/logsources"
	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/labels"
	"k8s.io/apimachinery/pkg/watch"
	"k8s.io/client-go/kubernetes"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/refresh/telemetry"
)

// Streamer manages Kubernetes container logs streaming sessions.
type Streamer struct {
	client    kubernetes.Interface
	logger    Logger
	telemetry *telemetry.Recorder
}

// NewStreamer constructs a Streamer.
func NewStreamer(client kubernetes.Interface, logger Logger, recorder *telemetry.Recorder) *Streamer {
	if logger == nil {
		logger = applog.Noop
	}
	return &Streamer{client: client, logger: logger, telemetry: recorder}
}

type containerTarget struct {
	namespace   string
	pod         string
	container   string
	isInit      bool
	isEphemeral bool
	state       *containerState
}

func (t containerTarget) key() string {
	return fmt.Sprintf(
		"%s/%s/%s",
		t.namespace,
		t.pod,
		containerlogs.ContainerRef{
			Name:        t.container,
			IsInit:      t.isInit,
			IsEphemeral: t.isEphemeral,
		}.SelectionValue(),
	)
}

// tail gathers the initial log history for the given options and prepares container state.
func (s *Streamer) tail(ctx context.Context, opts Options, limiterSession *TargetSession) ([]Entry, map[string]*containerState, []*corev1.Pod, string, []string, int, string, error) {
	pods, selector, err := s.listPods(ctx, opts)
	if err != nil {
		return nil, nil, nil, "", nil, 0, "", fmt.Errorf("containerlogsstream: tail %s/%s: %w", opts.Namespace, opts.Name, err)
	}
	selection := selectInitialLogTargets(pods, opts, limiterSession)
	entries, states := s.collectInitialLogEntries(ctx, selection.targets, opts)
	sortInitialLogEntries(entries)
	return entries, states, pods, selector, selection.warnings, selection.skipped, selection.skipReason, nil
}

type initialLogTargetSelection struct {
	targets    []containerTarget
	warnings   []string
	skipped    int
	skipReason string
}

func selectInitialLogTargets(pods []*corev1.Pod, opts Options, limiterSession *TargetSession) initialLogTargetSelection {
	targets, total := selectRuntimeTargets(pods, containerSelectionOptions(opts), containerlogs.GetPerScopeTargetLimit())
	selection := initialLogTargetSelection{
		targets: targets, warnings: containerlogs.BuildTargetLimitWarnings(len(targets), total),
		skipped: total - len(targets),
	}
	if selection.skipped > 0 {
		selection.skipReason = "per-scope target cap"
	}
	if limiterSession != nil {
		applyGlobalTargetLimit(&selection, limiterSession)
	}
	return selection
}

func containerSelectionOptions(opts Options) containerlogs.ContainerSelectionOptions {
	return containerlogs.ContainerSelectionOptions{
		Filter: opts.Container, IncludeInit: opts.IncludeInit, IncludeEphemeral: opts.IncludeEphemeral,
		StateFilter: opts.ContainerState, Selection: opts.Selection,
	}
}

func applyGlobalTargetLimit(selection *initialLogTargetSelection, session *TargetSession) {
	before := len(selection.targets)
	allowedKeys, globalSkipped := session.UpdateDesired(targetKeys(selection.targets))
	selection.targets = filterTargetsByKeys(selection.targets, allowedKeys)
	selection.warnings = append(selection.warnings, buildGlobalTargetLimitWarnings(
		len(selection.targets), before, targetSessionGlobalLimit(session),
	)...)
	if globalSkipped > 0 {
		selection.skipped += globalSkipped
		selection.skipReason = "global target cap"
	}
}

func targetSessionGlobalLimit(session *TargetSession) int {
	if session != nil && session.limiter != nil {
		return session.limiter.total
	}
	return config.ContainerLogsStreamGlobalTargetLimit
}

func (s *Streamer) collectInitialLogEntries(
	ctx context.Context,
	targets []containerTarget,
	opts Options,
) ([]Entry, map[string]*containerState) {
	var entries []Entry
	states := make(map[string]*containerState)
	for _, target := range targets {
		states[target.key()] = &containerState{}
		fetched, err := s.fetchContainerTail(ctx, target, opts.TailLines, opts.LineFilter)
		if err != nil {
			s.logger.Warn(fmt.Sprintf("containerlogsstream: tail failed for %s/%s/%s: %v", target.namespace, target.pod, target.container, err), logsources.ContainerLogsStream)
			continue
		}
		entries = append(entries, fetched...)
		updateInitialContainerState(states[target.key()], fetched)
	}
	return entries, states
}

func updateInitialContainerState(state *containerState, entries []Entry) {
	for _, entry := range entries {
		timestamp, err := time.Parse(time.RFC3339Nano, entry.Timestamp)
		if entry.Timestamp == "" || err != nil {
			continue
		}
		if timestamp.After(state.lastTimestamp) {
			state.lastTimestamp = timestamp
			state.linesAtTimestamp = map[string]struct{}{entry.Line: {}}
			continue
		}
		if timestamp.Equal(state.lastTimestamp) {
			state.linesAtTimestamp[entry.Line] = struct{}{}
		}
	}
}

func sortInitialLogEntries(entries []Entry) {
	sort.Slice(entries, func(i, j int) bool {
		ti, errI := time.Parse(time.RFC3339Nano, entries[i].Timestamp)
		tj, errJ := time.Parse(time.RFC3339Nano, entries[j].Timestamp)
		if errI != nil {
			return errJ != nil && i < j
		}
		if errJ != nil {
			return true
		}
		return ti.Before(tj)
	})
}

func (s *Streamer) run(
	ctx context.Context,
	opts Options,
	initialPods []*corev1.Pod,
	selector string,
	states map[string]*containerState,
	limiterSession *TargetSession,
	initialWarnings []string,
	entriesCh chan<- Entry,
	warningsCh chan<- []string,
	errCh chan<- error,
	dropCh chan<- int,
) {
	if opts.MatchNone {
		<-ctx.Done()
		return
	}
	run := newContainerLogRun(
		s, ctx, opts, states, limiterSession, initialWarnings,
		entriesCh, warningsCh, errCh, dropCh,
	)
	defer run.shutdown()
	run.replacePodInventory(initialPods)
	if strings.EqualFold(opts.Kind, "pod") {
		run.waitForPodSession()
		return
	}
	run.watchPods(selector)
}

type containerLogRun struct {
	streamer       *Streamer
	ctx            context.Context
	opts           Options
	states         map[string]*containerState
	limiterSession *TargetSession
	limiterNotify  <-chan struct{}
	entriesCh      chan<- Entry
	warningsCh     chan<- []string
	errCh          chan<- error
	dropCh         chan<- int

	mu              sync.Mutex
	targetWG        sync.WaitGroup
	currentPods     map[string]*corev1.Pod
	targetCancels   map[string]context.CancelFunc
	currentWarnings []string
}

func newContainerLogRun(
	streamer *Streamer,
	ctx context.Context,
	opts Options,
	states map[string]*containerState,
	limiterSession *TargetSession,
	initialWarnings []string,
	entriesCh chan<- Entry,
	warningsCh chan<- []string,
	errCh chan<- error,
	dropCh chan<- int,
) *containerLogRun {
	run := &containerLogRun{
		streamer: streamer, ctx: ctx, opts: opts, states: states, limiterSession: limiterSession,
		entriesCh: entriesCh, warningsCh: warningsCh, errCh: errCh, dropCh: dropCh,
		currentPods: make(map[string]*corev1.Pod), targetCancels: make(map[string]context.CancelFunc),
		currentWarnings: append([]string(nil), initialWarnings...),
	}
	if limiterSession != nil {
		run.limiterNotify = limiterSession.Notify()
	}
	return run
}

func (r *containerLogRun) shutdown() {
	r.cancelTargets()
	r.targetWG.Wait()
}

func (r *containerLogRun) cancelTargets() {
	r.mu.Lock()
	cancels := make([]context.CancelFunc, 0, len(r.targetCancels))
	for _, cancel := range r.targetCancels {
		cancels = append(cancels, cancel)
	}
	r.mu.Unlock()
	for _, cancel := range cancels {
		cancel()
	}
}

func (r *containerLogRun) startTarget(target containerTarget) {
	key := target.key()
	r.mu.Lock()
	if _, exists := r.targetCancels[key]; exists {
		r.mu.Unlock()
		return
	}
	targetCtx, cancel := context.WithCancel(r.ctx)
	r.targetCancels[key] = cancel
	target.state = r.containerState(key)
	r.targetWG.Add(1)
	r.mu.Unlock()
	go r.followTarget(targetCtx, target)
}

func (r *containerLogRun) containerState(key string) *containerState {
	state := r.states[key]
	if state == nil {
		state = &containerState{}
		r.states[key] = state
	}
	return state
}

func (r *containerLogRun) followTarget(ctx context.Context, target containerTarget) {
	defer r.targetWG.Done()
	defer func() {
		if recovered := recover(); recovered != nil {
			r.reportTargetPanic(recovered)
		}
	}()
	r.streamer.followContainer(ctx, target, r.opts.LineFilter, r.entriesCh, r.errCh, r.dropCh)
}

func (r *containerLogRun) reportTargetPanic(recovered any) {
	applog.ReportPanic(r.streamer.logger, recovered, "containerlogsstream: panic in followContainer", logsources.ContainerLogsStream)
	if r.streamer.telemetry != nil {
		r.streamer.telemetry.RecordStreamError(telemetry.StreamContainerLogs, fmt.Errorf("panic: %v", recovered))
	}
}

func (r *containerLogRun) stopTarget(key string) {
	r.mu.Lock()
	cancel, exists := r.targetCancels[key]
	if exists {
		delete(r.targetCancels, key)
	}
	r.mu.Unlock()
	if exists {
		cancel()
	}
}

func (r *containerLogRun) reconcileTargets() {
	pods, activeKeys := r.snapshotInventory()
	selectedTargets, warnings := selectActiveLogTargets(pods, r.opts, r.limiterSession)
	desiredTargets := indexLogTargets(selectedTargets)
	emitWarningsIfChanged(r.warningsCh, &r.currentWarnings, warnings)
	r.stopUndesiredTargets(activeKeys, desiredTargets)
	r.startDesiredTargets(activeKeys, desiredTargets)
}

func (r *containerLogRun) snapshotInventory() ([]*corev1.Pod, map[string]struct{}) {
	r.mu.Lock()
	defer r.mu.Unlock()
	pods := make([]*corev1.Pod, 0, len(r.currentPods))
	for _, pod := range r.currentPods {
		pods = append(pods, pod)
	}
	activeKeys := make(map[string]struct{}, len(r.targetCancels))
	for key := range r.targetCancels {
		activeKeys[key] = struct{}{}
	}
	return pods, activeKeys
}

func selectActiveLogTargets(pods []*corev1.Pod, opts Options, limiterSession *TargetSession) ([]containerTarget, []string) {
	selectionOpts := containerSelectionOptions(opts)
	selectedTargets, totalTargets := selectRuntimeTargets(pods, selectionOpts, containerlogs.GetPerScopeTargetLimit())
	perScopeCount := len(selectedTargets)
	warnings := containerlogs.BuildTargetLimitWarnings(perScopeCount, totalTargets)
	if limiterSession == nil {
		return selectedTargets, warnings
	}
	allowedKeys, _ := limiterSession.UpdateDesired(targetKeys(selectedTargets))
	selectedTargets = filterTargetsByKeys(selectedTargets, allowedKeys)
	warnings = append(warnings, buildGlobalTargetLimitWarnings(
		len(selectedTargets), perScopeCount, targetSessionGlobalLimit(limiterSession),
	)...)
	return selectedTargets, warnings
}

func indexLogTargets(targets []containerTarget) map[string]containerTarget {
	indexed := make(map[string]containerTarget, len(targets))
	for _, target := range targets {
		indexed[target.key()] = target
	}
	return indexed
}

func (r *containerLogRun) stopUndesiredTargets(activeKeys map[string]struct{}, desiredTargets map[string]containerTarget) {
	for key := range activeKeys {
		if _, desired := desiredTargets[key]; !desired {
			r.stopTarget(key)
		}
	}
}

func (r *containerLogRun) startDesiredTargets(activeKeys map[string]struct{}, desiredTargets map[string]containerTarget) {
	for key, target := range desiredTargets {
		if _, active := activeKeys[key]; !active {
			r.startTarget(target)
		}
	}
}

func (r *containerLogRun) replacePodInventory(pods []*corev1.Pod) {
	nextPods := make(map[string]*corev1.Pod, len(pods))
	for _, pod := range pods {
		if pod != nil {
			nextPods[pod.Name] = pod
		}
	}
	r.mu.Lock()
	r.currentPods = nextPods
	r.mu.Unlock()
	r.reconcileTargets()
}

func (r *containerLogRun) updatePod(pod *corev1.Pod) {
	if pod == nil {
		return
	}
	r.mu.Lock()
	r.currentPods[pod.Name] = pod
	r.mu.Unlock()
	r.reconcileTargets()
}

func (r *containerLogRun) removePod(name string) {
	r.mu.Lock()
	delete(r.currentPods, name)
	r.mu.Unlock()
	r.reconcileTargets()
}

func (r *containerLogRun) waitForPodSession() {
	for {
		select {
		case <-r.ctx.Done():
			return
		case <-r.limiterNotify:
			r.reconcileTargets()
		}
	}
}

func (r *containerLogRun) watchPods(selector string) {
	cronCache := make(map[string]bool)
	backoff := config.ContainerLogsStreamBackoffInitial
	for r.ctx.Err() == nil {
		watcher, err := r.openPodWatch(selector)
		if err != nil {
			if !r.handleWatchStartError(err, backoff) {
				return
			}
			backoff = nextBackoff(backoff)
			continue
		}
		err = r.consumePodWatch(watcher, cronCache)
		watcher.Stop()
		if !r.handleWatchEnd(err, backoff) {
			return
		}
		backoff = nextBackoff(backoff)
		r.refreshPodInventory()
	}
}

func (r *containerLogRun) openPodWatch(selector string) (watch.Interface, error) {
	return r.streamer.client.CoreV1().Pods(r.opts.Namespace).Watch(r.ctx, metav1.ListOptions{LabelSelector: selector})
}

func (r *containerLogRun) handleWatchStartError(err error, backoff time.Duration) bool {
	if r.ctx.Err() != nil {
		return false
	}
	r.streamer.logger.Warn(fmt.Sprintf("containerlogsstream: failed to start pod watch: %v", err), logsources.ContainerLogsStream)
	select {
	case r.errCh <- err:
	default:
	}
	return r.streamer.waitForReconnect(r.ctx, backoff)
}

func (r *containerLogRun) consumePodWatch(watcher watch.Interface, cronCache map[string]bool) error {
	return r.streamer.consumeWatch(
		r.ctx, watcher, r.opts, cronCache, r.limiterNotify, r.reconcileTargets, r.updatePod, r.removePod,
	)
}

func (r *containerLogRun) handleWatchEnd(err error, backoff time.Duration) bool {
	if err == nil || r.ctx.Err() != nil {
		return false
	}
	r.streamer.logger.Warn(fmt.Sprintf("containerlogsstream: pod watch ended (will retry): %v", err), logsources.ContainerLogsStream)
	if r.streamer.telemetry != nil {
		r.streamer.telemetry.RecordStreamError(telemetry.StreamContainerLogs, err)
	}
	return r.streamer.waitForReconnect(r.ctx, backoff)
}

func (r *containerLogRun) refreshPodInventory() {
	pods, _, err := r.streamer.listPods(r.ctx, r.opts)
	if err == nil {
		r.replacePodInventory(pods)
	}
}

func emitWarningsIfChanged(ch chan<- []string, current *[]string, next []string) {
	if ch == nil {
		*current = append((*current)[:0], next...)
		return
	}
	if stringSlicesEqual(*current, next) {
		return
	}
	copied := append([]string(nil), next...)
	*current = copied
	select {
	case ch <- copied:
	default:
	}
}

func (s *Streamer) waitForReconnect(ctx context.Context, delay time.Duration) bool {
	if delay <= 0 {
		delay = config.ContainerLogsStreamBackoffInitial
	}
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}

func nextBackoff(current time.Duration) time.Duration {
	if current <= 0 {
		return config.ContainerLogsStreamBackoffInitial
	}
	next := current * 2
	if next > config.ContainerLogsStreamBackoffMax {
		return config.ContainerLogsStreamBackoffMax
	}
	return next
}

func (s *Streamer) consumeWatch(
	ctx context.Context,
	watcher watch.Interface,
	opts Options,
	cronCache map[string]bool,
	limiterNotify <-chan struct{},
	reconcileTargets func(),
	startPod func(*corev1.Pod),
	stopPod func(string),
) error {
	if watcher == nil {
		return errors.New("containerlogsstream: watcher not initialised")
	}
	result := watcher.ResultChan()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-limiterNotify:
			if reconcileTargets != nil {
				reconcileTargets()
			}
		case event, ok := <-result:
			if !ok {
				return errors.New("watch channel closed")
			}
			if err := s.consumePodWatchEvent(ctx, event, opts, cronCache, startPod, stopPod); err != nil {
				return err
			}
		}
	}
}

func (s *Streamer) consumePodWatchEvent(
	ctx context.Context,
	event watch.Event,
	opts Options,
	cronCache map[string]bool,
	startPod func(*corev1.Pod),
	stopPod func(string),
) error {
	// watch.Error events may not close the channel, so surface an error to trigger a reconnect.
	if event.Type == watch.Error {
		if status, ok := event.Object.(*metav1.Status); ok {
			return fmt.Errorf("containerlogsstream: watch error: %s", status.Message)
		}
		return errors.New("containerlogsstream: watch error event")
	}
	pod, ok := event.Object.(*corev1.Pod)
	if !ok || !s.matchesPodWatch(ctx, opts, pod, cronCache) {
		return nil
	}
	switch event.Type {
	case watch.Added, watch.Modified:
		startPod(pod)
	case watch.Deleted:
		stopPod(pod.Name)
	}
	return nil
}

func (s *Streamer) matchesPodWatch(ctx context.Context, opts Options, pod *corev1.Pod, cronCache map[string]bool) bool {
	if strings.EqualFold(opts.Kind, "cronjob") && !s.podBelongsToCronJob(ctx, opts.Namespace, opts.Name, pod, cronCache) {
		return false
	}
	if opts.PodFilter != "" && pod.Name != opts.PodFilter {
		return false
	}
	return opts.Selection.MatchPod(pod.Name)
}

func (s *Streamer) followContainer(ctx context.Context, target containerTarget, lineFilter containerlogs.LineFilter, entriesCh chan<- Entry, errCh chan<- error, dropCh chan<- int) {
	if target.state == nil {
		target.state = &containerState{}
	}
	session := containerFollowSession{
		streamer: s, target: target, lineFilter: lineFilter,
		entriesCh: entriesCh, errCh: errCh, dropCh: dropCh,
		backoff: config.ContainerLogsStreamBackoffInitial,
	}
	session.run(ctx)
}

type containerFollowSession struct {
	streamer   *Streamer
	target     containerTarget
	lineFilter containerlogs.LineFilter
	entriesCh  chan<- Entry
	errCh      chan<- error
	dropCh     chan<- int
	backoff    time.Duration
}

func (s *containerFollowSession) run(ctx context.Context) {
	for ctx.Err() == nil {
		stream, err := s.open(ctx)
		if err != nil {
			if !s.handleOpenFailure(ctx, err) {
				return
			}
			continue
		}
		if !s.consume(ctx, stream) {
			return
		}
	}
}

func (s *containerFollowSession) open(ctx context.Context) (io.ReadCloser, error) {
	request := s.streamer.client.CoreV1().Pods(s.target.namespace).GetLogs(s.target.pod, s.logOptions())
	return request.Stream(ctx)
}

func (s *containerFollowSession) logOptions() *corev1.PodLogOptions {
	options := &corev1.PodLogOptions{Container: s.target.container, Follow: true, Timestamps: true}
	if !s.target.state.lastTimestamp.IsZero() {
		since := metav1.NewTime(s.target.state.lastTimestamp)
		options.SinceTime = &since
	}
	return options
}

func (s *containerFollowSession) handleOpenFailure(ctx context.Context, err error) bool {
	if errors.Is(err, context.Canceled) {
		return s.shouldContinue(ctx)
	}
	if !isTransientContainerLogError(err) {
		s.reportOpenFailure(err)
	}
	if apierrors.IsNotFound(err) {
		return false
	}
	return s.waitForRetry(ctx) && s.shouldContinue(ctx)
}

func isTransientContainerLogError(err error) bool {
	errText := err.Error()
	return apierrors.IsNotFound(err) ||
		strings.Contains(errText, "waiting to start") ||
		strings.Contains(errText, "container not found") ||
		strings.Contains(errText, "is not valid for pod") ||
		strings.Contains(errText, "ContainerCreating") ||
		strings.Contains(errText, "PodInitializing") ||
		(strings.Contains(errText, "previous terminated container") && strings.Contains(errText, "not found"))
}

func (s *containerFollowSession) reportOpenFailure(err error) {
	message := fmt.Sprintf(
		"containerlogsstream: follow failed for %s/%s/%s: %v",
		s.target.namespace, s.target.pod, s.target.container, err,
	)
	s.streamer.logger.Warn(message, logsources.ContainerLogsStream)
	streamErr := fmt.Errorf(
		"containerlogsstream: follow failed for %s/%s/%s: %w",
		s.target.namespace, s.target.pod, s.target.container, err,
	)
	select {
	case s.errCh <- streamErr:
	default:
	}
}

func (s *containerFollowSession) consume(ctx context.Context, stream io.ReadCloser) bool {
	scanner := linescanner.New(stream)
	for scanner.Scan() {
		if ctx.Err() != nil || !s.processLine(ctx, stream, scanner.Text()) {
			_ = stream.Close()
			return false
		}
	}
	closeErr := stream.Close()
	s.logStreamEnd(scanner.Err(), closeErr)
	return s.shouldContinue(ctx) && s.waitForRetry(ctx)
}

func (s *containerFollowSession) processLine(ctx context.Context, stream io.Closer, line string) bool {
	timestamp, content := splitTimestamp(line)
	if !s.lineFilter.Matches(content) {
		return true
	}
	entry := s.logEntry(timestamp, content)
	if !s.acceptTimestamp(timestamp, content) {
		return true
	}
	return s.deliver(ctx, stream, entry)
}

func (s *containerFollowSession) logEntry(timestamp, content string) Entry {
	return Entry{
		Timestamp: timestamp, Pod: s.target.pod, Container: s.target.container, Line: content,
		IsInit: s.target.isInit, IsEphemeral: s.target.isEphemeral,
	}
}

func (s *containerFollowSession) acceptTimestamp(timestamp, line string) bool {
	if timestamp == "" {
		return true
	}
	parsed, err := time.Parse(time.RFC3339Nano, timestamp)
	if err != nil {
		return true
	}
	if parsed.Before(s.target.state.lastTimestamp) {
		return false
	}
	if parsed.Equal(s.target.state.lastTimestamp) {
		return s.acceptLineAtCurrentTimestamp(line)
	}
	s.target.state.lastTimestamp = parsed
	s.target.state.linesAtTimestamp = map[string]struct{}{line: {}}
	return true
}

func (s *containerFollowSession) acceptLineAtCurrentTimestamp(line string) bool {
	if _, seen := s.target.state.linesAtTimestamp[line]; seen {
		return false
	}
	if s.target.state.linesAtTimestamp == nil {
		s.target.state.linesAtTimestamp = make(map[string]struct{})
	}
	s.target.state.linesAtTimestamp[line] = struct{}{}
	return true
}

func (s *containerFollowSession) deliver(ctx context.Context, stream io.Closer, entry Entry) bool {
	select {
	case s.entriesCh <- entry:
		return true
	case <-ctx.Done():
		_ = stream.Close()
		return false
	default:
		s.recordDrop()
		return true
	}
}

func (s *containerFollowSession) recordDrop() {
	if s.dropCh == nil {
		s.recordDropTelemetry()
		return
	}
	select {
	case s.dropCh <- 1:
	default:
		s.recordDropTelemetry()
	}
}

func (s *containerFollowSession) recordDropTelemetry() {
	if s.streamer.telemetry != nil {
		s.streamer.telemetry.RecordStreamDelivery(telemetry.StreamContainerLogs, 0, 1)
	}
}

func (s *containerFollowSession) logStreamEnd(scannerErr, closeErr error) {
	if isReportableStreamEndError(scannerErr) {
		s.streamer.logger.Debug(fmt.Sprintf(
			"containerlogsstream: scanner error for %s/%s/%s: %v",
			s.target.namespace, s.target.pod, s.target.container, scannerErr,
		), logsources.ContainerLogsStream)
	}
	if isReportableStreamEndError(closeErr) {
		s.streamer.logger.Debug(fmt.Sprintf(
			"containerlogsstream: stream closed with error for %s/%s/%s: %v",
			s.target.namespace, s.target.pod, s.target.container, closeErr,
		), logsources.ContainerLogsStream)
	}
}

func isReportableStreamEndError(err error) bool {
	return err != nil && !errors.Is(err, context.Canceled) && !errors.Is(err, io.EOF)
}

func (s *containerFollowSession) shouldContinue(ctx context.Context) bool {
	return s.streamer.shouldContinueStreaming(ctx, s.target)
}

func (s *containerFollowSession) waitForRetry(ctx context.Context) bool {
	timer := time.NewTimer(s.backoff)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}

func (s *Streamer) shouldContinueStreaming(ctx context.Context, target containerTarget) bool {
	if target.isInit {
		return false
	}
	if ctx == nil {
		return true
	}
	select {
	case <-ctx.Done():
		return false
	default:
	}

	pod, err := s.client.CoreV1().Pods(target.namespace).Get(ctx, target.pod, metav1.GetOptions{})
	if err != nil {
		// Stop retrying if the pod is gone; otherwise assume the container may come back.
		return !apierrors.IsNotFound(err)
	}

	if pod.DeletionTimestamp != nil {
		return false
	}

	switch pod.Status.Phase {
	case corev1.PodFailed, corev1.PodSucceeded:
		return false
	default:
		return true
	}
}

func (s *Streamer) listPods(ctx context.Context, opts Options) ([]*corev1.Pod, string, error) {
	if opts.MatchNone {
		return nil, "", nil
	}
	kind := strings.ToLower(opts.Kind)
	switch kind {
	case "pod":
		return s.listSinglePod(ctx, opts)
	case "deployment", "replicaset", "statefulset", "daemonset":
		return s.listWorkloadPods(ctx, opts, kind)
	case "job":
		return s.listJobPods(ctx, opts)
	case "cronjob":
		return s.listCronJobPods(ctx, opts)
	default:
		return nil, "", fmt.Errorf("containerlogsstream: unsupported workload kind %q", opts.Kind)
	}
}

func (s *Streamer) listSinglePod(ctx context.Context, opts Options) ([]*corev1.Pod, string, error) {
	pod, err := s.client.CoreV1().Pods(opts.Namespace).Get(ctx, opts.Name, metav1.GetOptions{})
	if err != nil {
		return nil, "", fmt.Errorf("containerlogsstream: get pod %s/%s: %w", opts.Namespace, opts.Name, err)
	}
	return filterPodsByName([]*corev1.Pod{pod}, opts.PodFilter, opts.PodNameFilter, opts.Selection), "", nil
}

func (s *Streamer) listWorkloadPods(ctx context.Context, opts Options, kind string) ([]*corev1.Pod, string, error) {
	selector, err := s.selectorForWorkload(ctx, opts)
	if err != nil {
		return nil, "", fmt.Errorf("containerlogsstream: selector for %s %s/%s: %w", kind, opts.Namespace, opts.Name, err)
	}
	pods, err := s.client.CoreV1().Pods(opts.Namespace).List(ctx, metav1.ListOptions{LabelSelector: selector})
	if err != nil {
		return nil, "", fmt.Errorf("containerlogsstream: list pods for %s %s/%s: %w", kind, opts.Namespace, opts.Name, err)
	}
	return filterPodsByName(podPointers(pods.Items), opts.PodFilter, opts.PodNameFilter, opts.Selection), selector, nil
}

func (s *Streamer) listJobPods(ctx context.Context, opts Options) ([]*corev1.Pod, string, error) {
	selector := labels.Set{"job-name": opts.Name}.AsSelector().String()
	pods, err := s.client.CoreV1().Pods(opts.Namespace).List(ctx, metav1.ListOptions{LabelSelector: selector})
	if err != nil {
		return nil, "", fmt.Errorf("containerlogsstream: list pods for job %s/%s: %w", opts.Namespace, opts.Name, err)
	}
	return filterPodsByName(podPointers(pods.Items), opts.PodFilter, opts.PodNameFilter, opts.Selection), selector, nil
}

func (s *Streamer) listCronJobPods(ctx context.Context, opts Options) ([]*corev1.Pod, string, error) {
	jobs, err := s.client.BatchV1().Jobs(opts.Namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, "", fmt.Errorf("containerlogsstream: list jobs for cronjob %s/%s: %w", opts.Namespace, opts.Name, err)
	}
	jobNames := cronJobNames(jobs.Items, opts.Name)
	if len(jobNames) == 0 {
		return nil, "", nil
	}
	selector := "job-name in (" + strings.Join(jobNames, ",") + ")"
	list, err := s.client.CoreV1().Pods(opts.Namespace).List(ctx, metav1.ListOptions{LabelSelector: selector})
	if err != nil {
		return nil, "", fmt.Errorf("containerlogsstream: list pods for cronjob %s/%s: %w", opts.Namespace, opts.Name, err)
	}
	// Return empty selector so the pod watch sees pods from future Jobs.
	// consumeWatch filters by CronJob ownership via podBelongsToCronJob.
	return filterPodsByName(podPointers(list.Items), opts.PodFilter, opts.PodNameFilter, opts.Selection), "", nil
}

func cronJobNames(jobs []batchv1.Job, cronJobName string) []string {
	var names []string
	for _, job := range jobs {
		for _, owner := range job.OwnerReferences {
			if owner.Kind == cronjobpkg.Identity.Kind && owner.Name == cronJobName {
				names = append(names, job.Name)
			}
		}
	}
	return names
}

func filterPodsByName(
	pods []*corev1.Pod,
	exactFilter string,
	podNameFilter containerlogs.PodNameFilter,
	selection containerlogs.ScopeSelection,
) []*corev1.Pod {
	exactFilter = strings.TrimSpace(exactFilter)
	if len(pods) == 0 {
		return pods
	}
	if exactFilter == "" && podNameFilter.IsZero() && selection.IsZero() {
		return pods
	}
	filtered := make([]*corev1.Pod, 0, len(pods))
	for _, pod := range pods {
		if pod == nil {
			continue
		}
		if exactFilter != "" && pod.Name != exactFilter {
			continue
		}
		if !podNameFilter.IsZero() && !podNameFilter.Match(pod.Name) {
			continue
		}
		if !selection.MatchPod(pod.Name) {
			continue
		}
		filtered = append(filtered, pod)
	}
	return filtered
}

func (s *Streamer) selectorForWorkload(ctx context.Context, opts Options) (string, error) {
	switch strings.ToLower(opts.Kind) {
	case "deployment":
		res, err := s.client.AppsV1().Deployments(opts.Namespace).Get(ctx, opts.Name, metav1.GetOptions{})
		if err != nil {
			return "", err
		}
		return metav1.FormatLabelSelector(res.Spec.Selector), nil
	case "replicaset":
		res, err := s.client.AppsV1().ReplicaSets(opts.Namespace).Get(ctx, opts.Name, metav1.GetOptions{})
		if err != nil {
			return "", err
		}
		return metav1.FormatLabelSelector(res.Spec.Selector), nil
	case "daemonset":
		res, err := s.client.AppsV1().DaemonSets(opts.Namespace).Get(ctx, opts.Name, metav1.GetOptions{})
		if err != nil {
			return "", err
		}
		return metav1.FormatLabelSelector(res.Spec.Selector), nil
	case "statefulset":
		res, err := s.client.AppsV1().StatefulSets(opts.Namespace).Get(ctx, opts.Name, metav1.GetOptions{})
		if err != nil {
			return "", err
		}
		return metav1.FormatLabelSelector(res.Spec.Selector), nil
	default:
		return "", fmt.Errorf("containerlogsstream: unsupported selector kind %q", opts.Kind)
	}
}

func podPointers(items []corev1.Pod) []*corev1.Pod {
	result := make([]*corev1.Pod, 0, len(items))
	for i := range items {
		pod := items[i]
		result = append(result, &pod)
	}
	return result
}

func selectRuntimeTargets(
	pods []*corev1.Pod,
	options containerlogs.ContainerSelectionOptions,
	limit int,
) ([]containerTarget, int) {
	selectedTargets, totalTargets := containerlogs.SelectTargets(pods, options, limit)
	runtimeTargets := make([]containerTarget, 0, len(selectedTargets))
	for _, selected := range selectedTargets {
		runtimeTargets = append(runtimeTargets, containerTarget{
			namespace:   selected.Namespace,
			pod:         selected.PodName,
			container:   selected.Container.Name,
			isInit:      selected.Container.IsInit,
			isEphemeral: selected.Container.IsEphemeral,
		})
	}
	return runtimeTargets, totalTargets
}

func targetKeys(targets []containerTarget) []string {
	keys := make([]string, 0, len(targets))
	for _, target := range targets {
		keys = append(keys, target.key())
	}
	return keys
}

func filterTargetsByKeys(targets []containerTarget, allowedKeys map[string]struct{}) []containerTarget {
	if len(allowedKeys) == 0 {
		return nil
	}
	filtered := make([]containerTarget, 0, len(targets))
	for _, target := range targets {
		if _, ok := allowedKeys[target.key()]; ok {
			filtered = append(filtered, target)
		}
	}
	return filtered
}

func stringSlicesEqual(left, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for i := range left {
		if left[i] != right[i] {
			return false
		}
	}
	return true
}

func (s *Streamer) fetchContainerTail(ctx context.Context, target containerTarget, tailLines int, lineFilter containerlogs.LineFilter) ([]Entry, error) {
	options := &corev1.PodLogOptions{
		Container:  target.container,
		Timestamps: true,
	}
	if tailLines > 0 {
		tail := int64(tailLines)
		options.TailLines = &tail
	}

	req := s.client.CoreV1().Pods(target.namespace).GetLogs(target.pod, options)
	stream, err := req.Stream(ctx)
	if err != nil {
		return nil, err
	}
	defer stream.Close()

	var entries []Entry
	scanner := linescanner.New(stream)
	for scanner.Scan() {
		line := scanner.Text()
		timestamp, content := splitTimestamp(line)
		if !lineFilter.Matches(content) {
			continue
		}
		entries = append(entries, Entry{
			Timestamp:   timestamp,
			Pod:         target.pod,
			Container:   target.container,
			Line:        content,
			IsInit:      target.isInit,
			IsEphemeral: target.isEphemeral,
		})
	}
	if err := scanner.Err(); err != nil && !errors.Is(err, io.EOF) {
		return entries, err
	}
	return entries, nil
}

func splitTimestamp(line string) (string, string) {
	idx := strings.IndexByte(line, ' ')
	if idx > 0 && idx < 32 {
		return line[:idx], line[idx+1:]
	}
	return "", line
}

func (s *Streamer) podBelongsToCronJob(ctx context.Context, namespace, cronJob string, pod *corev1.Pod, cache map[string]bool) bool {
	jobName := cronJobPodJobName(pod)
	if jobName == "" {
		return false
	}
	cacheKey := fmt.Sprintf("%s/%s", jobName, cronJob)
	if allowed, ok := cache[cacheKey]; ok {
		return allowed
	}

	s.evictCronJobCacheIfFull(cache)

	job, err := s.client.BatchV1().Jobs(namespace).Get(ctx, jobName, metav1.GetOptions{})
	if err != nil {
		s.logger.Debug(fmt.Sprintf("containerlogsstream: failed to fetch job %s: %v", jobName, err), logsources.ContainerLogsStream)
		cache[cacheKey] = false
		return false
	}
	allowed := jobOwnedByCronJob(job.OwnerReferences, cronJob)
	cache[cacheKey] = allowed
	return allowed
}

func cronJobPodJobName(pod *corev1.Pod) string {
	if pod == nil {
		return ""
	}
	if jobName := pod.Labels["job-name"]; jobName != "" {
		return jobName
	}
	for _, owner := range pod.OwnerReferences {
		if owner.Kind == jobpkg.Identity.Kind {
			return owner.Name
		}
	}
	return ""
}

func (s *Streamer) evictCronJobCacheIfFull(cache map[string]bool) {
	if len(cache) < config.ContainerLogsStreamCronCacheMaxSize {
		return
	}
	for key := range cache {
		delete(cache, key)
	}
	s.logger.Debug("containerlogsstream: cron cache evicted due to size limit", logsources.ContainerLogsStream)
}

func jobOwnedByCronJob(owners []metav1.OwnerReference, cronJob string) bool {
	for _, owner := range owners {
		if owner.Kind == cronjobpkg.Identity.Kind && owner.Name == cronJob {
			return true
		}
	}
	return false
}
