package containerlogsstream

import (
	"context"
	"errors"
	"fmt"
	"io"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/luxury-yacht/app/backend/internal/applog"
	"github.com/luxury-yacht/app/backend/internal/containerlogs"
	"github.com/luxury-yacht/app/backend/internal/logsources"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	coreinformers "k8s.io/client-go/informers/core/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/tools/cache"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/refresh/telemetry"
)

// Streamer manages Kubernetes container logs streaming sessions.
type Streamer struct {
	client        kubernetes.Interface
	logger        Logger
	telemetry     *telemetry.Recorder
	perScopeLimit int
	// The timings are fields so tests can shorten them.
	responseTimeout time.Duration
	caughtUpIdle    time.Duration
	historyGather   time.Duration
	historyDecision time.Duration
	removedPodGrace time.Duration
}

// NewStreamer constructs a Streamer.
func NewStreamer(client kubernetes.Interface, logger Logger, recorder *telemetry.Recorder, limits ...int) *Streamer {
	if logger == nil {
		logger = applog.Noop
	}
	limit := containerlogs.DefaultPerScopeTargetLimit
	if len(limits) > 0 {
		limit = containerlogs.ClampPerScopeTargetLimit(limits[0])
	}
	return &Streamer{
		client: client, logger: logger, telemetry: recorder, perScopeLimit: limit,
		responseTimeout: config.ContainerLogsStreamResponseTimeout,
		caughtUpIdle:    config.ContainerLogsStreamCaughtUpIdle,
		historyGather:   config.ContainerLogsStreamHistoryGather,
		historyDecision: config.ContainerLogsStreamHistoryDecision,
		removedPodGrace: config.ContainerLogsStreamRemovedPodGrace,
	}
}

type containerTarget struct {
	namespace   string
	pod         string
	container   string
	isInit      bool
	isEphemeral bool
	// instance is the container's runtime ID, empty before it first starts. A
	// new instance means the container restarted or its pod was recreated.
	instance string
	cursor   containerlogs.ResumeCursor
	// historySince is where a follower without a cursor starts reading: the
	// oldest line the client's buffer still keeps (or its history round's
	// cut-off after a failed second read), or zero while it has room.
	historySince time.Time
}

func (t containerTarget) ref() containerlogs.ContainerRef {
	return containerlogs.ContainerRef{Name: t.container, IsInit: t.isInit, IsEphemeral: t.isEphemeral}
}

func (t containerTarget) key() string {
	return t.namespace + "/" + t.pod + "/" + t.ref().SelectionValue()
}

// entry turns one timestamped log line into an entry. The text is kept as
// the JSON wire gives it to the client, so resume points match it.
func (t containerTarget) entry(line string) Entry {
	timestamp, content := containerlogs.SplitTimestamp(line)
	return Entry{
		Timestamp: timestamp, Pod: t.pod, Container: t.container, Line: containerlogs.WireText(content),
		IsInit: t.isInit, IsEphemeral: t.isEphemeral,
	}
}

// prepare resolves the session's pods and initial target selection without
// reading any logs; each target's follower reads its own history.
func (s *Streamer) prepare(ctx context.Context, opts Options, limiterSession *TargetSession) (containerLogsInitial, error) {
	resolution, err := s.resolve(ctx, opts)
	if err != nil {
		return containerLogsInitial{}, fmt.Errorf("containerlogsstream: resolve %s/%s: %w", opts.Namespace, opts.Name, err)
	}
	selection := selectLogTargets(resolution.Pods, opts, limiterSession, s.perScopeLimit)
	return containerLogsInitial{
		pods: resolution.Pods, watch: resolution.Watch,
		warnings: selection.warnings, skippedTargets: selection.skipped, skipReason: selection.skipReason,
	}, nil
}

type logTargetSelection struct {
	targets    []containerTarget
	warnings   []containerlogs.Warning
	skipped    int
	skipReason string
}

func selectLogTargets(pods []*corev1.Pod, opts Options, limiterSession *TargetSession, limit int) logTargetSelection {
	targets, total := selectRuntimeTargets(pods, opts.Selection, limit)
	selection := logTargetSelection{
		targets: targets, warnings: containerlogs.TargetLimitWarnings(containerlogs.LimitPerTab, len(targets), total, containerlogs.ClampPerScopeTargetLimit(limit)),
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

func applyGlobalTargetLimit(selection *logTargetSelection, session *TargetSession) {
	before := len(selection.targets)
	allowedKeys, globalSkipped := session.UpdateDesired(targetKeys(selection.targets))
	selection.targets = filterTargetsByKeys(selection.targets, allowedKeys)
	selection.warnings = append(selection.warnings, containerlogs.TargetLimitWarnings(
		containerlogs.LimitGlobal, len(selection.targets), before, targetSessionGlobalLimit(session),
	)...)
	if globalSkipped > 0 {
		selection.skipped += globalSkipped
		selection.skipReason = "global target cap"
	}
}

func targetSessionGlobalLimit(session *TargetSession) int {
	if session != nil && session.limiter != nil {
		return session.limiter.limit()
	}
	return config.ContainerLogsStreamGlobalTargetLimit
}

func entryTimestamp(entry Entry) string { return entry.Timestamp }

// parseLogTimestamp returns the zero time for a missing or unparseable timestamp.
func parseLogTimestamp(timestamp string) time.Time {
	parsed, err := time.Parse(time.RFC3339Nano, timestamp)
	if err != nil {
		return time.Time{}
	}
	return parsed
}

func (s *Streamer) run(
	ctx context.Context,
	initialPods []*corev1.Pod,
	podWatch *containerlogs.PodWatch,
	config containerLogRunConfig,
) {
	if config.opts.MatchNone {
		sealSnapshot(config.snapshot)
		<-ctx.Done()
		return
	}
	run := newContainerLogRun(s, config, podWatch)
	defer run.shutdown()
	run.setInitialPods(ctx, initialPods)
	sealSnapshot(config.snapshot)
	run.history.sealFirst()
	var events <-chan podEvent
	if podWatch != nil {
		events = run.startPodInformer(ctx)
	}
	run.serve(ctx, events)
}

// resolve returns the session's pods and pod watch through the resolver shared
// with direct fetches. A match-none selection reads nothing.
func (s *Streamer) resolve(ctx context.Context, opts Options) (containerlogs.Resolution, error) {
	if opts.MatchNone {
		return containerlogs.Resolution{}, nil
	}
	return containerlogs.Resolve(ctx, s.client, opts.target(), opts.Selection)
}

// containerLogRun owns one session's pod inventory and container followers.
// Pod events, limiter changes and follower exits are all applied on the run
// loop, so target reconciliation never runs concurrently.
type containerLogRun struct {
	streamer       *Streamer
	opts           Options
	podWatch       *containerlogs.PodWatch
	limiterSession *TargetSession
	limiterNotify  <-chan struct{}
	sink           entryAdder
	snapshot       *snapshotWait
	// history plans targets' history reads; nil without a client snapshot.
	history  *historyRounds
	warnings *warningUpdates
	issues   *issueSet
	fatal    chan<- error
	// followerExited wakes the run loop so a target waiting on its previous
	// follower, or a restarted container, is started.
	followerExited chan struct{}
	// removed names pods that ended and did not come back, so the client drops
	// their lines; nil without a client. removals holds each deleted pod's grace
	// timer and removalDue receives it when it fires; both belong to the run loop.
	removed       chan<- string
	removals      map[string]*time.Timer
	removalDue    chan string
	forbiddenOnce sync.Once

	mu          sync.Mutex
	targetWG    sync.WaitGroup
	currentPods map[string]*corev1.Pod
	// seeded holds the resolved pods the informer has not reported yet. Its
	// first list is the authority: seeds it never reports were deleted before
	// it listed, and it will never report their deletion.
	seeded map[string]struct{}
	// followers holds every follower that has not exited, including stopped
	// ones, so a target never has two followers reading at once.
	followers map[string]context.CancelFunc
	// finished records the container instance at which a target's follower
	// ended on its own; only a new instance starts that target again.
	finished        map[string]string
	cursors         map[string]containerlogs.ResumeCursor
	currentWarnings []containerlogs.Warning
}

type containerLogRunConfig struct {
	opts            Options
	limiterSession  *TargetSession
	initialWarnings []containerlogs.Warning
	sink            entryAdder
	snapshot        *snapshotWait
	warnings        *warningUpdates
	issues          *issueSet
	// sent follows the lines sent to the client; nil without a client.
	sent *sentLines
	// removed receives pods that ended and did not come back.
	removed chan<- string
	// fatal receives a failure that ends the session.
	fatal chan<- error
}

func sealSnapshot(snapshot *snapshotWait) {
	if snapshot != nil {
		snapshot.seal()
	}
}

func newContainerLogRun(streamer *Streamer, config containerLogRunConfig, podWatch *containerlogs.PodWatch) *containerLogRun {
	run := &containerLogRun{
		streamer: streamer, opts: config.opts, podWatch: podWatch, limiterSession: config.limiterSession,
		sink: config.sink, snapshot: config.snapshot, warnings: config.warnings, issues: config.issues,
		fatal: config.fatal, followerExited: make(chan struct{}, 1),
		removed: config.removed, removals: map[string]*time.Timer{}, removalDue: make(chan string, 16),
		currentPods: map[string]*corev1.Pod{}, seeded: map[string]struct{}{}, followers: map[string]context.CancelFunc{},
		finished: map[string]string{}, cursors: map[string]containerlogs.ResumeCursor{},
		currentWarnings: append([]containerlogs.Warning(nil), config.initialWarnings...),
	}
	if config.limiterSession != nil {
		run.limiterNotify = config.limiterSession.Notify()
	}
	if config.snapshot != nil {
		run.history = newHistoryRounds(config.opts.MaxEntries, config.opts.MaxBytes, config.sent, streamer.historyGather, streamer.historyDecision)
	}
	return run
}

func (r *containerLogRun) serve(ctx context.Context, events <-chan podEvent) {
	for {
		select {
		case <-ctx.Done():
			return
		case event := <-events:
			r.applyPodEvent(ctx, event)
		case <-r.limiterNotify:
			r.reconcileTargets(ctx)
		case <-r.followerExited:
			r.reconcileTargets(ctx)
		case name := <-r.removalDue:
			r.reportRemoval(ctx, name)
		}
	}
}

func (r *containerLogRun) shutdown() {
	for _, timer := range r.removals {
		timer.Stop()
	}
	r.mu.Lock()
	cancels := make([]context.CancelFunc, 0, len(r.followers))
	for _, cancel := range r.followers {
		cancels = append(cancels, cancel)
	}
	r.mu.Unlock()
	for _, cancel := range cancels {
		cancel()
	}
	r.targetWG.Wait()
}

// startTarget starts a follower unless the target still has one, or its last
// follower finished at this same container instance.
func (r *containerLogRun) startTarget(ctx context.Context, target containerTarget) {
	key := target.key()
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, following := r.followers[key]; following {
		return
	}
	if instance, finished := r.finished[key]; finished && instance == target.instance {
		return
	}
	targetCtx, cancel := context.WithCancel(ctx)
	r.followers[key] = cancel
	// Only one follower per target runs at a time and it writes its cursor back
	// before its slot is released, so the next follower resumes where it ended.
	target.cursor = r.cursors[key].Clone()
	// A target without a resume point reads its history in a round with the
	// others starting now.
	var round *historyRound
	if target.cursor.IsZero() {
		round = r.history.join(key)
	}
	caughtUp := func() {
		// Without a first snapshot, nothing waits for this follower's history.
	}
	if r.snapshot != nil {
		caughtUp = r.snapshot.expect(key)
	}
	r.targetWG.Add(1)
	go r.followTarget(targetCtx, target, caughtUp, round)
}

func (r *containerLogRun) followTarget(ctx context.Context, target containerTarget, caughtUp func(), round *historyRound) {
	defer r.targetWG.Done()
	defer caughtUp()
	cursor := target.cursor
	defer func() { r.finishTarget(ctx, target, cursor) }()
	defer r.recoverFollower()
	if round != nil {
		target = r.deliverPlannedHistory(ctx, target, round, caughtUp)
		cursor = target.cursor
	}
	cursor = r.streamer.followContainer(ctx, target, r.sink, followOptions{
		tailLines: r.opts.MaxEntries, caughtUp: caughtUp, issues: r.issues,
		running: func() bool { return r.containerRunning(target) },
	})
}

// deliverPlannedHistory reads the target's history through its round and
// delivers it. The returned target follows on from the newest line read or,
// when its follow request reads the history, from where readPlannedHistory says.
func (r *containerLogRun) deliverPlannedHistory(ctx context.Context, target containerTarget, round *historyRound, caughtUp func()) containerTarget {
	history, since, ok := r.readPlannedHistory(ctx, target, round)
	target.historySince = since
	if !ok {
		return target
	}
	for _, entry := range history {
		r.sink.add(entry)
		target.cursor.Observe(parseLogTimestamp(entry.Timestamp), entry.Line)
	}
	caughtUp()
	return target
}

// readPlannedHistory returns the target's history and where its follow request
// starts when it reads the history itself. It reports false in that case: its
// round is too small to share, or a read failed. A failed second read follows
// from the cut-off, since the first read left out lines the buffer can hold.
func (r *containerLogRun) readPlannedHistory(ctx context.Context, target containerTarget, round *historyRound) ([]Entry, time.Time, bool) {
	key := target.key()
	share, ok := round.shareFor(ctx)
	floor := share.floor
	if !ok || share.lines == 0 {
		round.withdraw(key)
		return nil, floor, false
	}
	read, leftOut, err := r.streamer.readHistory(ctx, target, share.lines, share.bytes, floor)
	if err != nil {
		round.withdraw(key)
		r.streamer.logger.Debug(fmt.Sprintf("containerlogsstream: history read failed for %s, following instead: %v", key, err), logsources.ContainerLogsStream)
		return nil, floor, false
	}
	cutoff, decided := round.report(ctx, key, read)
	if !decided {
		return nil, floor, false
	}
	if !readsFurther(read, leftOut || len(read) >= share.lines, cutoff) {
		return read, floor, true
	}
	more, _, err := r.streamer.readHistory(ctx, target, r.opts.MaxEntries, r.opts.MaxBytes, cutoff)
	if err != nil {
		r.streamer.logger.Debug(fmt.Sprintf("containerlogsstream: second history read failed for %s, following from the cut-off: %v", key, err), logsources.ContainerLogsStream)
		return nil, cutoff, false
	}
	return more, floor, true
}

func (r *containerLogRun) recoverFollower() {
	if recovered := recover(); recovered != nil {
		applog.ReportPanic(r.streamer.logger, recovered, "containerlogsstream: panic in followContainer", logsources.ContainerLogsStream)
		if r.streamer.telemetry != nil {
			r.streamer.telemetry.RecordStreamError(telemetry.StreamContainerLogs, fmt.Errorf("panic: %v", recovered))
		}
	}
}

// finishTarget releases a follower's slot. A follower that ended on its own,
// rather than being stopped, records the container instance it ended at.
func (r *containerLogRun) finishTarget(ctx context.Context, target containerTarget, cursor containerlogs.ResumeCursor) {
	key := target.key()
	r.mu.Lock()
	cancel := r.followers[key]
	delete(r.followers, key)
	// A removed pod's targets are forgotten; its exiting followers must not
	// bring their state back.
	if _, known := r.currentPods[target.pod]; known {
		r.cursors[key] = cursor
		if ctx.Err() == nil {
			r.finished[key] = target.instance
		}
	}
	r.mu.Unlock()
	if ctx.Err() != nil {
		// A stopped target's problem no longer applies.
		r.issues.clear(key)
	}
	if cancel != nil {
		cancel()
	}
	select {
	case r.followerExited <- struct{}{}:
	default:
	}
}

// containerRunning reports whether the latest pod state shows the follower's
// container instance still running.
func (r *containerLogRun) containerRunning(target containerTarget) bool {
	r.mu.Lock()
	pod := r.currentPods[target.pod]
	r.mu.Unlock()
	status, ok := containerlogs.ContainerStatus(pod, target.ref())
	return ok && status.State.Running != nil && status.ContainerID == target.instance
}

func (r *containerLogRun) stopTarget(key string) {
	r.mu.Lock()
	cancel := r.followers[key]
	r.mu.Unlock()
	if cancel != nil {
		cancel()
	}
}

func (r *containerLogRun) reconcileTargets(ctx context.Context) {
	pods, followingKeys := r.snapshotInventory()
	selection := selectLogTargets(pods, r.opts, r.limiterSession, r.streamer.perScopeLimit)
	desiredTargets := indexLogTargets(selection.targets)
	emitWarningsIfChanged(r.warnings, &r.currentWarnings, selection.warnings)
	r.issues.retain(func(key string) bool {
		_, desired := desiredTargets[key]
		return desired
	})
	for _, key := range followingKeys {
		if _, desired := desiredTargets[key]; !desired {
			r.stopTarget(key)
		}
	}
	for _, target := range desiredTargets {
		r.startTarget(ctx, target)
	}
}

func (r *containerLogRun) snapshotInventory() ([]*corev1.Pod, []string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	pods := make([]*corev1.Pod, 0, len(r.currentPods))
	for _, pod := range r.currentPods {
		pods = append(pods, pod)
	}
	keys := make([]string, 0, len(r.followers))
	for key := range r.followers {
		keys = append(keys, key)
	}
	return pods, keys
}

func indexLogTargets(targets []containerTarget) map[string]containerTarget {
	indexed := make(map[string]containerTarget, len(targets))
	for _, target := range targets {
		indexed[target.key()] = target
	}
	return indexed
}

func (r *containerLogRun) setInitialPods(ctx context.Context, pods []*corev1.Pod) {
	r.mu.Lock()
	for _, pod := range pods {
		if pod != nil {
			r.currentPods[pod.Name] = pod
			r.seeded[pod.Name] = struct{}{}
		}
	}
	// The client's resume points apply only to pods present now; a pod that
	// appears later is new to the session, as after removePod.
	for _, target := range r.opts.Resume {
		if _, present := r.currentPods[target.pod]; present {
			r.cursors[target.key()] = target.cursor.Clone()
		}
	}
	r.mu.Unlock()
	r.reconcileTargets(ctx)
}

// podEvent is one pod change delivered by the session's informer, or the
// marker that its first list has been delivered.
type podEvent struct {
	pod     *corev1.Pod
	deleted bool
	synced  bool
}

// startPodInformer keeps the session's pods current. The informer's reflector
// lists and watches with the PodWatch selectors, re-lists after an expired
// watch, and reports pods deleted in the meantime as deletions.
func (r *containerLogRun) startPodInformer(ctx context.Context) <-chan podEvent {
	events := make(chan podEvent, 64)
	informer := coreinformers.NewFilteredPodInformer(r.streamer.client, r.podWatch.Namespace, 0, cache.Indexers{},
		func(options *metav1.ListOptions) {
			options.LabelSelector = r.podWatch.LabelSelector
			options.FieldSelector = r.podWatch.FieldSelector
		})
	_ = informer.SetWatchErrorHandlerWithContext(func(_ context.Context, _ *cache.Reflector, err error) {
		r.handleWatchError(err)
	})
	send := func(obj any, deleted bool) {
		if pod := podFromInformerObject(obj); pod != nil {
			select {
			case events <- podEvent{pod: pod, deleted: deleted}:
			case <-ctx.Done():
			}
		}
	}
	registration, err := informer.AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc:    func(obj any) { send(obj, false) },
		UpdateFunc: func(_, obj any) { send(obj, false) },
		DeleteFunc: func(obj any) { send(obj, true) },
	})
	go informer.RunWithContext(ctx)
	if err == nil {
		go signalFirstListDelivered(ctx, events, registration.HasSynced)
	}
	return events
}

// signalFirstListDelivered sends the synced marker once the informer's first
// list has been handed to its event handler; the marker follows those events
// on the channel.
func signalFirstListDelivered(ctx context.Context, events chan<- podEvent, delivered cache.InformerSynced) {
	if !cache.WaitForCacheSync(ctx.Done(), delivered) {
		return
	}
	select {
	case events <- podEvent{synced: true}:
	case <-ctx.Done():
	}
}

func podFromInformerObject(obj any) *corev1.Pod {
	if tombstone, ok := obj.(cache.DeletedFinalStateUnknown); ok {
		obj = tombstone.Obj
	}
	pod, _ := obj.(*corev1.Pod)
	return pod
}

// handleWatchError ends the session when the user may not list or watch pods.
// The reflector retries every other error itself, and an expired watch is
// routine, so nothing else is surfaced.
func (r *containerLogRun) handleWatchError(err error) {
	if !apierrors.IsForbidden(err) {
		r.streamer.logger.Debug(fmt.Sprintf("containerlogsstream: pod watch interrupted: %v", err), logsources.ContainerLogsStream)
		return
	}
	r.forbiddenOnce.Do(func() {
		select {
		case r.fatal <- err:
		default:
		}
	})
}

func (r *containerLogRun) applyPodEvent(ctx context.Context, event podEvent) {
	if event.synced {
		r.removeUnlistedSeeds(ctx)
		return
	}
	r.mu.Lock()
	delete(r.seeded, event.pod.Name)
	r.mu.Unlock()
	if event.deleted {
		r.removePod(ctx, event.pod.Name)
		return
	}
	if !r.ownsPod(ctx, event.pod) {
		return
	}
	r.mu.Lock()
	r.currentPods[event.pod.Name] = event.pod
	r.mu.Unlock()
	r.cancelRemoval(event.pod.Name)
	r.reconcileTargets(ctx)
}

func (r *containerLogRun) ownsPod(ctx context.Context, pod *corev1.Pod) bool {
	owned, err := r.podWatch.Owns(ctx, pod)
	if err != nil {
		r.streamer.logger.Debug(fmt.Sprintf("containerlogsstream: pod ownership lookup failed: %v", err), logsources.ContainerLogsStream)
	}
	return owned && r.opts.Selection.MatchPod(pod.Name)
}

// removeUnlistedSeeds removes the resolved pods the informer's first list did
// not contain; they were deleted before it listed.
func (r *containerLogRun) removeUnlistedSeeds(ctx context.Context) {
	r.mu.Lock()
	unlisted := make([]string, 0, len(r.seeded))
	for name := range r.seeded {
		unlisted = append(unlisted, name)
	}
	r.seeded = map[string]struct{}{}
	r.mu.Unlock()
	for _, name := range unlisted {
		r.removePod(ctx, name)
	}
}

// removePod stops the pod's followers and forgets their resume state, so a
// pod recreated with the same name starts fresh.
func (r *containerLogRun) removePod(ctx context.Context, name string) {
	r.mu.Lock()
	_, known := r.currentPods[name]
	delete(r.currentPods, name)
	prefix := r.opts.Namespace + "/" + name + "/"
	for key := range r.cursors {
		if strings.HasPrefix(key, prefix) {
			delete(r.cursors, key)
		}
	}
	for key := range r.finished {
		if strings.HasPrefix(key, prefix) {
			delete(r.finished, key)
		}
	}
	r.mu.Unlock()
	if known {
		r.scheduleRemoval(ctx, name)
		r.reconcileTargets(ctx)
	}
}

// scheduleRemoval names the pod to the client once the grace has passed, so it
// drops the pod's lines. A pod recreated with the same name in the meantime (a
// StatefulSet pod) keeps them.
func (r *containerLogRun) scheduleRemoval(ctx context.Context, name string) {
	if r.removed == nil {
		return
	}
	r.cancelRemoval(name)
	r.removals[name] = time.AfterFunc(r.streamer.removedPodGrace, func() {
		select {
		case r.removalDue <- name:
		case <-ctx.Done():
		}
	})
}

func (r *containerLogRun) cancelRemoval(name string) {
	if timer, pending := r.removals[name]; pending {
		timer.Stop()
		delete(r.removals, name)
	}
}

// reportRemoval names a removed pod unless it came back after its timer fired.
func (r *containerLogRun) reportRemoval(ctx context.Context, name string) {
	delete(r.removals, name)
	r.mu.Lock()
	_, present := r.currentPods[name]
	r.mu.Unlock()
	if present {
		return
	}
	select {
	case r.removed <- name:
	case <-ctx.Done():
	}
}

func emitWarningsIfChanged(updates *warningUpdates, current *[]containerlogs.Warning, next []containerlogs.Warning) {
	if slices.Equal(*current, next) {
		return
	}
	*current = append([]containerlogs.Warning(nil), next...)
	updates.set(*current)
}

// followOptions carries what a follower needs from its session.
type followOptions struct {
	// tailLines bounds the history read when the follower has no resume point.
	tailLines int
	// caughtUp is called once the follower's history has been delivered.
	caughtUp func()
	// running reports whether the container instance is still running; the
	// follower reopens an ended or failed stream only while it is.
	running func() bool
	// issues records why the container's logs cannot be read, if they cannot.
	issues *issueSet
}

// followContainer streams one container until it stops or ctx ends, and
// returns the resume cursor at the point it stopped.
func (s *Streamer) followContainer(ctx context.Context, target containerTarget, sink entryAdder, options followOptions) containerlogs.ResumeCursor {
	caughtUp, running := options.caughtUp, options.running
	if caughtUp == nil {
		caughtUp = func() {
			// Nothing waits for this follower's history.
		}
	}
	if running == nil {
		running = func() bool { return false }
	}
	session := containerFollowSession{
		streamer: s, target: target, cursor: target.cursor.Clone(),
		sink: sink, issues: options.issues, tailLines: options.tailLines, caughtUp: caughtUp, running: running,
		backoff: config.ContainerLogsStreamBackoffInitial,
	}
	session.run(ctx)
	return session.cursor
}

type containerFollowSession struct {
	streamer  *Streamer
	target    containerTarget
	cursor    containerlogs.ResumeCursor
	sink      entryAdder
	issues    *issueSet
	tailLines int
	caughtUp  func()
	running   func() bool
	backoff   time.Duration
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
		s.issues.clear(s.target.key())
		if !s.consume(ctx, stream) {
			return
		}
	}
}

// open starts one follow request. A request that returns no response headers
// within the response timeout is abandoned; the request context also governs
// the established body, so the timer only fires while Stream has not returned.
func (s *containerFollowSession) open(ctx context.Context) (io.ReadCloser, error) {
	requestCtx, cancel := context.WithCancel(ctx)
	timer := time.AfterFunc(s.streamer.responseTimeout, cancel)
	request := s.streamer.client.CoreV1().Pods(s.target.namespace).GetLogs(s.target.pod, s.logOptions())
	stream, err := request.Stream(requestCtx)
	if !timer.Stop() && ctx.Err() == nil {
		if stream != nil {
			_ = stream.Close()
		}
		cancel()
		return nil, fmt.Errorf("no response within %s", s.streamer.responseTimeout)
	}
	if err != nil {
		cancel()
		return nil, err
	}
	return &cancelOnClose{ReadCloser: stream, cancel: cancel}, nil
}

// cancelOnClose releases a request's context when its stream is closed.
type cancelOnClose struct {
	io.ReadCloser
	cancel context.CancelFunc
}

func (c *cancelOnClose) Close() error {
	err := c.ReadCloser.Close()
	c.cancel()
	return err
}

// logOptions reads at most tailLines lines, from the cursor's second when
// resuming. The client never holds more of one container's lines than that,
// so a resume after a long gap reads nothing it could show. If the bound cuts
// into the lines at the cursor timestamp, the tracker cannot match them and
// releases them, repeating lines rather than losing any.
func (s *containerFollowSession) logOptions() *corev1.PodLogOptions {
	options := &corev1.PodLogOptions{Container: s.target.container, Follow: true, Timestamps: true}
	if since := s.since(); !since.IsZero() {
		sinceTime := metav1.NewTime(since)
		options.SinceTime = &sinceTime
	}
	if s.tailLines > 0 {
		tail := int64(s.tailLines)
		options.TailLines = &tail
	}
	return options
}

// since is where the next open starts: the cursor when resuming, otherwise the
// target's history start.
func (s *containerFollowSession) since() time.Time {
	if !s.cursor.IsZero() {
		return s.cursor.Since()
	}
	return s.target.historySince
}

func (s *containerFollowSession) handleOpenFailure(ctx context.Context, err error) bool {
	// Nothing more will arrive for the snapshot from this attempt.
	s.caughtUp()
	// A pod that is gone is removed by the watch; it is not an issue.
	if ctx.Err() != nil || apierrors.IsNotFound(err) {
		return false
	}
	s.reportOpenFailure(err)
	return s.shouldRetry(ctx)
}

func (s *containerFollowSession) reportOpenFailure(err error) {
	issue := containerlogs.NewTargetIssue(s.target.pod, s.target.ref(), err)
	if issue.State != containerlogs.IssueUnavailable {
		s.streamer.logger.Warn(fmt.Sprintf(
			"containerlogsstream: follow failed for %s/%s/%s: %v",
			s.target.namespace, s.target.pod, s.target.container, err,
		), logsources.ContainerLogsStream)
	}
	s.issues.set(s.target.key(), issue)
}

// consume reads one opened stream through a resume tracker. Lines are read on a
// separate goroutine so replay deadlines and cancellation are handled even while
// a quiet stream blocks the read.
func (s *containerFollowSession) consume(ctx context.Context, stream io.ReadCloser) bool {
	stop := make(chan struct{})
	defer close(stop)
	lines := readStreamLines(stream, stop)
	tracker := containerlogs.NewLineTracker[Entry](&s.cursor)
	deadline := time.NewTimer(time.Hour)
	deadline.Stop()
	defer deadline.Stop()
	// History arrives back-to-back; the first idle gap after opening ends it.
	idle := time.NewTimer(s.streamer.caughtUpIdle)
	defer idle.Stop()
	for {
		armReplayDeadline(deadline, tracker)
		select {
		case <-ctx.Done():
			_ = stream.Close()
			return false
		case <-idle.C:
			s.caughtUp()
		case <-deadline.C:
			s.deliverAll(tracker.Expire(time.Now()))
		case read := <-lines:
			if read.err != nil {
				return s.finishStream(ctx, stream, tracker, read.err)
			}
			idle.Reset(s.streamer.caughtUpIdle)
			entry := s.target.entry(read.line)
			s.deliverAll(tracker.Offer(parseLogTimestamp(entry.Timestamp), entry.Line, entry, time.Now()))
		}
	}
}

func (s *containerFollowSession) finishStream(ctx context.Context, stream io.Closer, tracker *containerlogs.LineTracker[Entry], readErr error) bool {
	s.deliverAll(tracker.Finish())
	s.caughtUp()
	closeErr := stream.Close()
	s.logStreamEnd(readErr, closeErr)
	return s.shouldRetry(ctx)
}

type streamLine struct {
	line string
	err  error
}

// readStreamLines forwards lines until the stream fails or ends (the error is
// sent last) or stop is closed.
func readStreamLines(stream io.Reader, stop <-chan struct{}) <-chan streamLine {
	lines := make(chan streamLine)
	go func() {
		reader := containerlogs.NewLineReader(stream)
		for {
			line, err := reader.Next()
			select {
			case lines <- streamLine{line: line, err: err}:
			case <-stop:
				return
			}
			if err != nil {
				return
			}
		}
	}()
	return lines
}

func armReplayDeadline(timer *time.Timer, tracker *containerlogs.LineTracker[Entry]) {
	if deadline, ok := tracker.Deadline(); ok {
		timer.Reset(time.Until(deadline))
		return
	}
	timer.Stop()
}

func (s *containerFollowSession) deliverAll(entries []Entry) {
	for _, entry := range entries {
		s.sink.add(entry)
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

// shouldRetry waits out the backoff while the container is running. The pod
// state is checked again afterwards because a stream usually ends just before
// the watch reports the container stopped.
func (s *containerFollowSession) shouldRetry(ctx context.Context) bool {
	return s.running() && s.waitForRetry(ctx) && s.running()
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

func selectRuntimeTargets(
	pods []*corev1.Pod,
	selection containerlogs.ScopeSelection,
	limit int,
) ([]containerTarget, int) {
	selectedTargets, totalTargets := containerlogs.SelectTargets(pods, selection, limit)
	podsByName := make(map[string]*corev1.Pod, len(pods))
	for _, pod := range pods {
		if pod != nil {
			podsByName[pod.Name] = pod
		}
	}
	runtimeTargets := make([]containerTarget, 0, len(selectedTargets))
	for _, selected := range selectedTargets {
		status, _ := containerlogs.ContainerStatus(podsByName[selected.PodName], selected.Container)
		runtimeTargets = append(runtimeTargets, containerTarget{
			namespace:   selected.Namespace,
			pod:         selected.PodName,
			container:   selected.Container.Name,
			isInit:      selected.Container.IsInit,
			isEphemeral: selected.Container.IsEphemeral,
			instance:    status.ContainerID,
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
