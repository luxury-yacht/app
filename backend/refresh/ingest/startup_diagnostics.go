package ingest

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	apimeta "k8s.io/apimachinery/pkg/api/meta"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	apiruntime "k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/watch"
	"k8s.io/client-go/tools/cache"
	"k8s.io/client-go/util/watchlist"
	"k8s.io/klog/v2"
)

type initialSyncPhase string

const (
	initialSyncPhaseQueued initialSyncPhase = "queued"
	initialSyncPhaseActive initialSyncPhase = "active"
	initialSyncPhaseSynced initialSyncPhase = "synced"
)

// initialIngestTaskTelemetry separates scheduler delay from Kubernetes request
// delay for one GVR/namespace startup task. All fields are protected because the
// queue, reflector, readiness observer, and diagnostic logger run concurrently.
type initialIngestTaskTelemetry struct {
	mu sync.Mutex

	queuePosition      int
	priority           bool
	queuedAt           time.Time
	startedAt          time.Time
	syncedAt           time.Time
	deadlineReleasedAt time.Time

	listAttempts      int
	watchListAttempts int
	watchAttempts     int
	inFlight          int
	lastListItems     int
	lastListDuration  time.Duration
	lastWatchDuration time.Duration
	lastError         string
	lastErrorAt       time.Time
}

func newInitialIngestTaskTelemetry() *initialIngestTaskTelemetry {
	return &initialIngestTaskTelemetry{queuePosition: -1}
}

func (t *initialIngestTaskTelemetry) markQueued(position int, priority bool, at time.Time) {
	t.mu.Lock()
	t.queuePosition = position
	t.priority = priority
	t.queuedAt = at
	t.mu.Unlock()
}

func (t *initialIngestTaskTelemetry) markStarted(at time.Time) {
	t.mu.Lock()
	if t.startedAt.IsZero() {
		t.startedAt = at
	}
	t.mu.Unlock()
}

func (t *initialIngestTaskTelemetry) markDeadlineReleased(at time.Time) {
	t.mu.Lock()
	if t.deadlineReleasedAt.IsZero() {
		t.deadlineReleasedAt = at
	}
	t.mu.Unlock()
}

func (t *initialIngestTaskTelemetry) markSynced(at time.Time) bool {
	t.mu.Lock()
	if !t.syncedAt.IsZero() {
		t.mu.Unlock()
		return false
	}
	t.syncedAt = at
	recoveredAfterDeadline := !t.deadlineReleasedAt.IsZero()
	t.mu.Unlock()
	return recoveredAfterDeadline
}

type initialRequestKind uint8

const (
	initialRequestList initialRequestKind = iota
	initialRequestWatchList
	initialRequestWatch
)

func (t *initialIngestTaskTelemetry) beginRequest(kind initialRequestKind) bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	if !t.syncedAt.IsZero() {
		return false
	}
	switch kind {
	case initialRequestList:
		t.listAttempts++
	case initialRequestWatchList:
		t.watchListAttempts++
	case initialRequestWatch:
		t.watchAttempts++
	}
	t.inFlight++
	return true
}

func (t *initialIngestTaskTelemetry) finishRequest(
	tracked bool,
	kind initialRequestKind,
	at time.Time,
	duration time.Duration,
	items int,
	err error,
) {
	if !tracked {
		return
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.inFlight > 0 {
		t.inFlight--
	}
	if kind == initialRequestList {
		t.lastListItems = items
		t.lastListDuration = duration
	} else {
		t.lastWatchDuration = duration
	}
	if err != nil {
		t.lastError = err.Error()
		t.lastErrorAt = at
	}
}

type initialRequestDiagnostic struct {
	ListAttempts      int
	WatchListAttempts int
	WatchAttempts     int
	InFlight          int
	LastListItems     int
	LastListDuration  time.Duration
	LastWatchDuration time.Duration
	LastError         string
	LastErrorAt       time.Time
}

func (t *initialIngestTaskTelemetry) requestSnapshot() initialRequestDiagnostic {
	t.mu.Lock()
	defer t.mu.Unlock()
	return initialRequestDiagnostic{
		ListAttempts:      t.listAttempts,
		WatchListAttempts: t.watchListAttempts,
		WatchAttempts:     t.watchAttempts,
		InFlight:          t.inFlight,
		LastListItems:     t.lastListItems,
		LastListDuration:  t.lastListDuration,
		LastWatchDuration: t.lastWatchDuration,
		LastError:         t.lastError,
		LastErrorAt:       t.lastErrorAt,
	}
}

type initialSyncDiagnostic struct {
	GVR              schema.GroupVersionResource
	Namespace        string
	QueuePosition    int
	Priority         bool
	Phase            initialSyncPhase
	QueueWait        time.Duration
	Active           time.Duration
	Total            time.Duration
	DeadlineExceeded bool
	DeadlineReleased bool
	QueuedAtDeadline bool
	Degraded         bool
	Request          initialRequestDiagnostic
}

func (t *initialIngestTaskTelemetry) snapshot(
	gvr schema.GroupVersionResource,
	namespace string,
	now time.Time,
	deadlineAt time.Time,
	degraded bool,
) initialSyncDiagnostic {
	t.mu.Lock()
	defer t.mu.Unlock()

	phase := initialSyncPhaseQueued
	if !t.syncedAt.IsZero() {
		phase = initialSyncPhaseSynced
	} else if !t.startedAt.IsZero() {
		phase = initialSyncPhaseActive
	}
	queueEnd := now
	if !t.startedAt.IsZero() {
		queueEnd = t.startedAt
	}
	active := time.Duration(0)
	if !t.startedAt.IsZero() {
		activeEnd := now
		if !t.syncedAt.IsZero() {
			activeEnd = t.syncedAt
		}
		active = nonNegativeDuration(activeEnd.Sub(t.startedAt))
	}
	totalEnd := now
	if !t.syncedAt.IsZero() {
		totalEnd = t.syncedAt
	}
	deadlineExceeded := !deadlineAt.IsZero() && now.After(deadlineAt)
	queuedAtDeadline := deadlineExceeded && (t.startedAt.IsZero() || t.startedAt.After(deadlineAt))

	return initialSyncDiagnostic{
		GVR:              gvr,
		Namespace:        namespace,
		QueuePosition:    t.queuePosition,
		Priority:         t.priority,
		Phase:            phase,
		QueueWait:        nonNegativeDuration(queueEnd.Sub(t.queuedAt)),
		Active:           active,
		Total:            nonNegativeDuration(totalEnd.Sub(t.queuedAt)),
		DeadlineExceeded: deadlineExceeded,
		DeadlineReleased: !t.deadlineReleasedAt.IsZero(),
		QueuedAtDeadline: queuedAtDeadline,
		Degraded:         degraded,
		Request: initialRequestDiagnostic{
			ListAttempts:      t.listAttempts,
			WatchListAttempts: t.watchListAttempts,
			WatchAttempts:     t.watchAttempts,
			InFlight:          t.inFlight,
			LastListItems:     t.lastListItems,
			LastListDuration:  t.lastListDuration,
			LastWatchDuration: t.lastWatchDuration,
			LastError:         t.lastError,
			LastErrorAt:       t.lastErrorAt,
		},
	}
}

func nonNegativeDuration(value time.Duration) time.Duration {
	if value < 0 {
		return 0
	}
	return value
}

// startupDiagnosticListerWatcher observes only request boundaries; it does not
// alter options, retry policy, returned objects, or watch streams.
type startupDiagnosticListerWatcher struct {
	delegate   cache.ListerWatcher
	contextual cache.ListerWatcherWithContext
	telemetry  *initialIngestTaskTelemetry
	now        func() time.Time
}

func newStartupDiagnosticListerWatcher(
	delegate cache.ListerWatcher,
	telemetry *initialIngestTaskTelemetry,
	now func() time.Time,
) *startupDiagnosticListerWatcher {
	return &startupDiagnosticListerWatcher{
		delegate:   delegate,
		contextual: cache.ToListerWatcherWithContext(delegate),
		telemetry:  telemetry,
		now:        now,
	}
}

func (lw *startupDiagnosticListerWatcher) List(options metav1.ListOptions) (apiruntime.Object, error) {
	return lw.ListWithContext(context.Background(), options)
}

func (lw *startupDiagnosticListerWatcher) ListWithContext(ctx context.Context, options metav1.ListOptions) (apiruntime.Object, error) {
	startedAt := lw.now()
	tracked := lw.telemetry.beginRequest(initialRequestList)
	result, err := lw.contextual.ListWithContext(ctx, options)
	finishedAt := lw.now()
	items := 0
	if err == nil && result != nil {
		items = apimeta.LenList(result)
	}
	lw.telemetry.finishRequest(tracked, initialRequestList, finishedAt, finishedAt.Sub(startedAt), items, err)
	return result, err
}

func (lw *startupDiagnosticListerWatcher) Watch(options metav1.ListOptions) (watch.Interface, error) {
	return lw.WatchWithContext(context.Background(), options)
}

func (lw *startupDiagnosticListerWatcher) WatchWithContext(ctx context.Context, options metav1.ListOptions) (watch.Interface, error) {
	kind := initialRequestWatch
	if options.SendInitialEvents != nil && *options.SendInitialEvents {
		kind = initialRequestWatchList
	}
	startedAt := lw.now()
	tracked := lw.telemetry.beginRequest(kind)
	result, err := lw.contextual.WatchWithContext(ctx, options)
	finishedAt := lw.now()
	lw.telemetry.finishRequest(tracked, kind, finishedAt, finishedAt.Sub(startedAt), 0, err)
	return result, err
}

// Preserve the capability marker carried by ToListWatcherWithWatchListSemantics;
// hiding it behind this diagnostic wrapper would change reflector behavior.
func (lw *startupDiagnosticListerWatcher) IsWatchListSemanticsUnSupported() bool {
	return watchlist.DoesClientNotSupportWatchListSemantics(lw.delegate)
}

func (m *IngestManager) initialSyncStartedAt() time.Time {
	m.startedAtMu.Lock()
	defer m.startedAtMu.Unlock()
	return m.startedAt
}

func (m *IngestManager) initialSyncDeadlineAt() time.Time {
	startedAt := m.initialSyncStartedAt()
	if startedAt.IsZero() || m.syncDeadline <= 0 {
		return time.Time{}
	}
	return startedAt.Add(m.syncDeadline)
}

func (m *IngestManager) initialSyncDiagnostics() []initialSyncDiagnostic {
	m.mu.Lock()
	type diagnosticEntry struct {
		gvr      schema.GroupVersionResource
		degraded bool
		parts    []*ingestPart
	}
	entries := make([]diagnosticEntry, 0, len(m.entries))
	for gvr, entry := range m.entries {
		entries = append(entries, diagnosticEntry{
			gvr:      gvr,
			degraded: entry.degraded.Load(),
			parts:    append([]*ingestPart(nil), entry.parts...),
		})
	}
	m.mu.Unlock()

	now := m.now()
	deadlineAt := m.initialSyncDeadlineAt()
	diagnostics := make([]initialSyncDiagnostic, 0)
	for _, entry := range entries {
		for _, part := range entry.parts {
			if part.startup == nil || part.skipped.Load() {
				continue
			}
			diagnostics = append(diagnostics, part.startup.snapshot(entry.gvr, part.namespace, now, deadlineAt, entry.degraded))
		}
	}
	sort.Slice(diagnostics, func(i, j int) bool {
		if diagnostics[i].QueuePosition != diagnostics[j].QueuePosition {
			return diagnostics[i].QueuePosition < diagnostics[j].QueuePosition
		}
		if diagnostics[i].GVR != diagnostics[j].GVR {
			return diagnostics[i].GVR.String() < diagnostics[j].GVR.String()
		}
		return diagnostics[i].Namespace < diagnostics[j].Namespace
	})
	return diagnostics
}

func formatInitialSyncDiagnostic(diagnostic initialSyncDiagnostic) string {
	namespace := diagnostic.Namespace
	if namespace == "" {
		namespace = "<cluster>"
	}
	phase := string(diagnostic.Phase)
	if diagnostic.Degraded && diagnostic.Phase != initialSyncPhaseSynced {
		phase += "+degraded"
	}
	requestParts := make([]string, 0, 3)
	if diagnostic.Request.WatchListAttempts > 0 {
		requestParts = append(requestParts, fmt.Sprintf("watchlist:%d", diagnostic.Request.WatchListAttempts))
	}
	if diagnostic.Request.ListAttempts > 0 {
		requestParts = append(requestParts, fmt.Sprintf("list:%d(items=%d last=%dms)",
			diagnostic.Request.ListAttempts,
			diagnostic.Request.LastListItems,
			diagnostic.Request.LastListDuration.Milliseconds(),
		))
	}
	if diagnostic.Request.WatchAttempts > 0 {
		requestParts = append(requestParts, fmt.Sprintf("watch:%d", diagnostic.Request.WatchAttempts))
	}
	if len(requestParts) == 0 {
		requestParts = append(requestParts, "none")
	}
	if diagnostic.Request.InFlight > 0 {
		requestParts = append(requestParts, fmt.Sprintf("inflight:%d", diagnostic.Request.InFlight))
	}
	result := fmt.Sprintf("%s ns=%q state=%s priority=%t position=%d queue=%dms active=%dms total=%dms requests=%s",
		diagnostic.GVR.String(),
		namespace,
		phase,
		diagnostic.Priority,
		diagnostic.QueuePosition,
		diagnostic.QueueWait.Milliseconds(),
		diagnostic.Active.Milliseconds(),
		diagnostic.Total.Milliseconds(),
		strings.Join(requestParts, ","),
	)
	if diagnostic.QueuedAtDeadline {
		result += " queuedAtDeadline=true"
	}
	if diagnostic.Request.LastError != "" {
		result += fmt.Sprintf(" lastError=%q", diagnostic.Request.LastError)
	}
	return result
}

func (m *IngestManager) formatEntryInitialSyncDiagnostics(entry *entry) string {
	now := m.now()
	deadlineAt := m.initialSyncDeadlineAt()
	diagnostics := make([]initialSyncDiagnostic, 0, len(entry.parts))
	for _, part := range entry.parts {
		if part.startup == nil || part.skipped.Load() {
			continue
		}
		diagnostics = append(diagnostics, part.startup.snapshot(entry.gvr, part.namespace, now, deadlineAt, entry.degraded.Load()))
	}
	if len(diagnostics) == 0 {
		return "startup diagnostics unavailable"
	}
	sort.Slice(diagnostics, func(i, j int) bool { return diagnostics[i].Total > diagnostics[j].Total })
	const maxParts = 3
	parts := make([]string, 0, maxParts)
	for index, diagnostic := range diagnostics {
		if index == maxParts {
			break
		}
		parts = append(parts, formatInitialSyncDiagnostic(diagnostic))
	}
	return strings.Join(parts, "; ")
}

func (m *IngestManager) logInitialIngestRecovery(task initialIngestTask) {
	diagnostic := task.part.startup.snapshot(
		task.launch.gvr,
		task.part.namespace,
		m.now(),
		m.initialSyncDeadlineAt(),
		task.launch.e.degraded.Load(),
	)
	klog.Infof("ingest initial data recovered after startup deadline for cluster %s: %s",
		m.meta.ClusterName, formatInitialSyncDiagnostic(diagnostic))
}
