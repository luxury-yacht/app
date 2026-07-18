package snapshot

import (
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
	corelisters "k8s.io/client-go/listers/core/v1"
	"k8s.io/client-go/tools/cache"

	"github.com/luxury-yacht/app/backend/kind/objectmap"
	"github.com/luxury-yacht/app/backend/kind/objectmapnode"
	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/objectcatalog"
	"github.com/luxury-yacht/app/backend/refresh/metrics"
)

// fakeNamespaceIngest is a minimal namespacePodIngestSource whose presence rows
// and sync state the tests mutate directly.
type fakeNamespaceIngest struct {
	mu           sync.Mutex
	synced       bool
	workloadNS   []string
	presentation string
	podRows      []streamrows.PodAggregate
	quotaRows    []streamrows.ResourceQuotaAggregate
	quotaReads   int
}

func (f *fakeNamespaceIngest) Tracks(schema.GroupVersionResource) bool { return true }
func (f *fakeNamespaceIngest) HasSyncedFor(schema.GroupVersionResource) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.synced
}
func (f *fakeNamespaceIngest) RawHasSyncedFor(gvr schema.GroupVersionResource) bool {
	return f.HasSyncedFor(gvr)
}
func (f *fakeNamespaceIngest) PermissionSkippedFor(schema.GroupVersionResource) bool {
	return false
}
func (f *fakeNamespaceIngest) CatalogRows(gvr schema.GroupVersionResource) []interface{} {
	f.mu.Lock()
	defer f.mu.Unlock()
	if gvr != DeploymentGVR {
		return nil
	}
	rows := make([]interface{}, 0, len(f.workloadNS))
	for _, ns := range f.workloadNS {
		rows = append(rows, objectcatalog.Summary{Kind: "Deployment", Namespace: ns, Name: "d"})
	}
	return rows
}
func (f *fakeNamespaceIngest) AggregateRows(gvr schema.GroupVersionResource) []interface{} {
	f.mu.Lock()
	defer f.mu.Unlock()
	if gvr == PodGVR {
		rows := make([]interface{}, 0, len(f.podRows))
		for _, row := range f.podRows {
			rows = append(rows, row)
		}
		return rows
	}
	if gvr != ResourceQuotaGVR {
		return nil
	}
	f.quotaReads++
	rows := make([]interface{}, 0, len(f.quotaRows))
	for _, row := range f.quotaRows {
		rows = append(rows, row)
	}
	return rows
}
func (f *fakeNamespaceIngest) ObjectMapRows(gvr schema.GroupVersionResource) []interface{} {
	f.mu.Lock()
	defer f.mu.Unlock()
	if gvr != DeploymentGVR {
		return nil
	}
	rows := make([]interface{}, 0, len(f.workloadNS))
	for _, ns := range f.workloadNS {
		rows = append(rows, objectmapnode.Node{
			Namespace: ns,
			Name:      "d",
			Status:    &objectmap.Status{Presentation: f.presentation},
		})
	}
	return rows
}

func (f *fakeNamespaceIngest) set(synced bool, workloadNS ...string) {
	f.mu.Lock()
	f.synced = synced
	f.workloadNS = workloadNS
	f.mu.Unlock()
}

func (f *fakeNamespaceIngest) setPresentation(presentation string) {
	f.mu.Lock()
	f.presentation = presentation
	f.mu.Unlock()
}

func (f *fakeNamespaceIngest) setPodRows(rows ...streamrows.PodAggregate) {
	f.mu.Lock()
	f.podRows = append([]streamrows.PodAggregate(nil), rows...)
	f.mu.Unlock()
}

func (f *fakeNamespaceIngest) setQuotaRows(rows ...streamrows.ResourceQuotaAggregate) {
	f.mu.Lock()
	f.quotaRows = append([]streamrows.ResourceQuotaAggregate(nil), rows...)
	f.mu.Unlock()
}

func (f *fakeNamespaceIngest) resetQuotaReads() {
	f.mu.Lock()
	f.quotaReads = 0
	f.mu.Unlock()
}

func (f *fakeNamespaceIngest) quotaReadCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.quotaReads
}

type mutableNamespaceMetrics struct {
	mu     sync.Mutex
	sample metrics.Sample
}

func (m *mutableNamespaceMetrics) set(sample metrics.Sample) {
	m.mu.Lock()
	m.sample = sample
	m.mu.Unlock()
}

func (m *mutableNamespaceMetrics) Sample() metrics.Sample {
	m.mu.Lock()
	defer m.mu.Unlock()
	return metrics.Sample{
		NodeUsage: map[string]metrics.NodeUsage{},
		PodUsage:  m.sample.PodUsage,
		Metadata:  m.sample.Metadata,
	}
}

func (m *mutableNamespaceMetrics) LatestNodeUsage() map[string]metrics.NodeUsage {
	return m.Sample().NodeUsage
}
func (m *mutableNamespaceMetrics) LatestPodUsage() map[string]metrics.PodUsage {
	return m.Sample().PodUsage
}
func (m *mutableNamespaceMetrics) Metadata() metrics.Metadata { return m.Sample().Metadata }

type broadcastRecorder struct {
	mu       sync.Mutex
	versions []string
	reasons  []string
}

func (r *broadcastRecorder) record(version, reason string) {
	r.mu.Lock()
	r.versions = append(r.versions, version)
	r.reasons = append(r.reasons, reason)
	r.mu.Unlock()
}

func (r *broadcastRecorder) lastReason() string {
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(r.reasons) == 0 {
		return ""
	}
	return r.reasons[len(r.reasons)-1]
}

func (r *broadcastRecorder) count() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.versions)
}

func waitForBroadcasts(t *testing.T, r *broadcastRecorder, want int) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if r.count() >= want {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("expected at least %d broadcast(s), got %d", want, r.count())
}

func requireNoMoreBroadcasts(t *testing.T, r *broadcastRecorder, have int) {
	t.Helper()
	time.Sleep(120 * time.Millisecond)
	require.Equal(t, have, r.count(), "no further broadcasts expected")
}

func newNotifierForTest(ingest *fakeNamespaceIngest, recorder *broadcastRecorder) *NamespaceChangeNotifier {
	notifier := NewNamespaceChangeNotifier(ingest, NewNamespaceWorkloadTracker(ingest), nil)
	notifier.debounce = 20 * time.Millisecond
	if recorder != nil {
		notifier.SetBroadcast(recorder.record)
	}
	return notifier
}

// A namespace-object event must broadcast even when the presence signature is
// unchanged (phase/status changes don't alter presence).
func TestNamespaceNotifierBroadcastsOnNamespaceEvent(t *testing.T) {
	ingest := &fakeNamespaceIngest{}
	ingest.set(true)
	recorder := &broadcastRecorder{}
	notifier := newNotifierForTest(ingest, recorder)
	defer notifier.Stop()

	notifier.NamespaceChanged()
	waitForBroadcasts(t, recorder, 1)
	requireNoMoreBroadcasts(t, recorder, 1)
	require.Contains(t, recorder.lastReason(), "namespace object changed",
		"the broadcast reason must say WHAT rang the doorbell")
}

// Workload/pod ingest events broadcast ONLY when the presence signature changes:
// steady pod churn inside already-populated namespaces must stay silent.
func TestNamespaceNotifierGatesWorkloadEventsOnPresenceSignature(t *testing.T) {
	ingest := &fakeNamespaceIngest{}
	ingest.set(true, "team-a")
	recorder := &broadcastRecorder{}
	notifier := newNotifierForTest(ingest, recorder)
	defer notifier.Stop()

	// First workload event establishes the presence baseline -> one broadcast.
	notifier.WorkloadChanged()
	waitForBroadcasts(t, recorder, 1)

	// Churn with an UNCHANGED presence set: no broadcast.
	notifier.WorkloadChanged()
	notifier.WorkloadChanged()
	requireNoMoreBroadcasts(t, recorder, 1)

	// A presence flip (new namespace gains its first workload) broadcasts.
	ingest.set(true, "team-a", "team-b")
	notifier.WorkloadChanged()
	waitForBroadcasts(t, recorder, 2)
	requireNoMoreBroadcasts(t, recorder, 2)
	require.Contains(t, recorder.lastReason(), "workload rollup changed",
		"the broadcast reason must say WHAT rang the doorbell")
}

func TestNamespaceNotifierBroadcastsWhenWorkloadHealthChanges(t *testing.T) {
	ingest := &fakeNamespaceIngest{}
	ingest.set(true, "team-a")
	ingest.setPresentation("ready")
	recorder := &broadcastRecorder{}
	notifier := newNotifierForTest(ingest, recorder)
	defer notifier.Stop()

	notifier.WorkloadChanged()
	waitForBroadcasts(t, recorder, 1)

	ingest.setPresentation("warning")
	notifier.WorkloadChanged()
	waitForBroadcasts(t, recorder, 2)
	require.Contains(t, recorder.lastReason(), "workload rollup changed")
}

func TestNamespaceNotifierBroadcastsWhenPodReservationsChange(t *testing.T) {
	ingest := &fakeNamespaceIngest{}
	ingest.set(true)
	ingest.setPodRows(streamrows.PodAggregate{
		Namespace:       "team-a",
		Name:            "api-0",
		Phase:           string(corev1.PodRunning),
		CPURequestMilli: 100,
	})
	recorder := &broadcastRecorder{}
	notifier := newNotifierForTest(ingest, recorder)
	defer notifier.Stop()

	notifier.WorkloadChanged()
	waitForBroadcasts(t, recorder, 1)

	ingest.setPodRows(streamrows.PodAggregate{
		Namespace:       "team-a",
		Name:            "api-0",
		Phase:           string(corev1.PodRunning),
		CPURequestMilli: 200,
	})
	notifier.WorkloadChanged()
	waitForBroadcasts(t, recorder, 2)
	require.Contains(t, recorder.lastReason(), "workload rollup changed")
}

func TestNamespaceNotifierGatesMetricCollectionsOnRevision(t *testing.T) {
	ingest := &fakeNamespaceIngest{}
	ingest.set(true)
	provider := &mutableNamespaceMetrics{}
	provider.set(metrics.Sample{
		PodUsage: map[string]metrics.PodUsage{"team-a/api": {CPUUsageMilli: 50}},
		Metadata: metrics.Metadata{CollectedAt: time.Unix(1700000000, 0), SuccessCount: 1},
	})
	recorder := &broadcastRecorder{}
	notifier := NewNamespaceChangeNotifier(ingest, NewNamespaceWorkloadTracker(ingest), provider)
	notifier.debounce = 20 * time.Millisecond
	notifier.SetBroadcast(recorder.record)
	defer notifier.Stop()

	notifier.MetricsChanged()
	waitForBroadcasts(t, recorder, 1)
	notifier.MetricsChanged()
	requireNoMoreBroadcasts(t, recorder, 1)

	provider.set(metrics.Sample{
		PodUsage: map[string]metrics.PodUsage{"team-a/api": {CPUUsageMilli: 75}},
		Metadata: metrics.Metadata{CollectedAt: time.Unix(1700000030, 0), SuccessCount: 2},
	})
	notifier.MetricsChanged()
	waitForBroadcasts(t, recorder, 2)
	require.Contains(t, recorder.lastReason(), "namespace utilization changed")
}

func TestNamespaceNotifierGatesQuotaEventsOnPressureRollup(t *testing.T) {
	ingest := &fakeNamespaceIngest{}
	ingest.set(true)
	ingest.setQuotaRows(streamrows.ResourceQuotaAggregate{Namespace: "team-a", HighestUsedPercentage: 75})
	recorder := &broadcastRecorder{}
	notifier := newNotifierForTest(ingest, recorder)
	defer notifier.Stop()

	notifier.QuotaChanged()
	waitForBroadcasts(t, recorder, 1)
	notifier.QuotaChanged()
	requireNoMoreBroadcasts(t, recorder, 1)

	ingest.setQuotaRows(streamrows.ResourceQuotaAggregate{Namespace: "team-a", HighestUsedPercentage: 95})
	notifier.QuotaChanged()
	waitForBroadcasts(t, recorder, 2)
	require.Contains(t, recorder.lastReason(), "quota pressure changed")
}

func TestNamespaceNotifierSkipsQuotaRollupWhenQuotaStateIsClean(t *testing.T) {
	ingest := &fakeNamespaceIngest{}
	ingest.set(true)
	recorder := &broadcastRecorder{}
	notifier := newNotifierForTest(ingest, recorder)
	defer notifier.Stop()

	notifier.NamespaceChanged()
	waitForBroadcasts(t, recorder, 1)
	ingest.resetQuotaReads()

	notifier.NamespaceChanged()
	waitForBroadcasts(t, recorder, 2)

	require.Zero(t, ingest.quotaReadCount())
}

func TestNamespaceNotifierBroadcastsOnlyWhenWarningEventRollupChanges(t *testing.T) {
	ingest := &fakeNamespaceIngest{}
	ingest.set(true)
	indexer := cache.NewIndexer(cache.MetaNamespaceKeyFunc, cache.Indexers{})
	recorder := &broadcastRecorder{}
	notifier := newNotifierForTest(ingest, recorder)
	notifier.eventLister = corelisters.NewEventLister(indexer)
	notifier.eventsExpected = true
	notifier.eventsSynced = func() bool { return true }
	defer notifier.Stop()

	notifier.EventChanged()
	waitForBroadcasts(t, recorder, 1)

	require.NoError(t, indexer.Add(&corev1.Event{
		ObjectMeta:     metav1.ObjectMeta{Name: "warning", Namespace: "team-a"},
		InvolvedObject: corev1.ObjectReference{Namespace: "team-a"},
		Type:           corev1.EventTypeWarning,
	}))
	notifier.EventChanged()
	waitForBroadcasts(t, recorder, 2)
	require.Contains(t, recorder.lastReason(), "warning event count changed")

	require.NoError(t, indexer.Add(&corev1.Event{
		ObjectMeta:     metav1.ObjectMeta{Name: "normal", Namespace: "team-a"},
		InvolvedObject: corev1.ObjectReference{Namespace: "team-a"},
		Type:           corev1.EventTypeNormal,
	}))
	notifier.EventChanged()
	requireNoMoreBroadcasts(t, recorder, 2)
}

// A burst of events inside one debounce window coalesces to a single broadcast.
func TestNamespaceNotifierCoalescesBursts(t *testing.T) {
	ingest := &fakeNamespaceIngest{}
	ingest.set(true)
	recorder := &broadcastRecorder{}
	notifier := newNotifierForTest(ingest, recorder)
	defer notifier.Stop()

	for range 10 {
		notifier.NamespaceChanged()
	}
	waitForBroadcasts(t, recorder, 1)
	requireNoMoreBroadcasts(t, recorder, 1)
}

// The cluster-Ready lifecycle gate needs a namespaces BUILD after the workload
// stores settle. The notifier must therefore re-arm while the tracker is not
// ready and broadcast when readiness flips — even if no further ingest event
// arrives — then stop re-arming.
func TestNamespaceNotifierSignalsTrackerReadinessFlip(t *testing.T) {
	ingest := &fakeNamespaceIngest{}
	ingest.set(false, "team-a")
	recorder := &broadcastRecorder{}
	notifier := newNotifierForTest(ingest, recorder)
	defer notifier.Stop()

	// Not-ready baseline: the first workload event broadcasts (signature includes
	// the not-ready bit).
	notifier.WorkloadChanged()
	waitForBroadcasts(t, recorder, 1)

	// Readiness flips with NO further events: the self-rearm must catch it.
	ingest.set(true, "team-a")
	waitForBroadcasts(t, recorder, 2)
}

// A stopped notifier must go fully silent — torn-down subsystems previously
// kept broadcasting through their rearm/debounce timers ("-> 0 scope(s)" spam).
func TestNamespaceNotifierStopSilencesBroadcasts(t *testing.T) {
	ingest := &fakeNamespaceIngest{}
	ingest.set(true)
	recorder := &broadcastRecorder{}
	notifier := newNotifierForTest(ingest, recorder)

	notifier.Stop()
	notifier.NamespaceChanged()
	notifier.WorkloadChanged()
	requireNoMoreBroadcasts(t, recorder, 0)
}

// Informer resyncs re-deliver every object with an UNCHANGED ResourceVersion;
// treating them as real updates broadcast a doorbell every resync period
// (observed live: a metronome of doorbells every 15s per cluster).
func TestNamespaceUpdateIsEchoSkipsResyncDeliveries(t *testing.T) {
	older := &corev1.Namespace{}
	older.Name = "team-a"
	older.ResourceVersion = "100"
	same := &corev1.Namespace{}
	same.Name = "team-a"
	same.ResourceVersion = "100"
	newer := &corev1.Namespace{}
	newer.Name = "team-a"
	newer.ResourceVersion = "101"

	require.True(t, namespaceUpdateIsEcho(older, same), "same ResourceVersion is a resync echo")
	require.False(t, namespaceUpdateIsEcho(older, newer), "advanced ResourceVersion is a real update")
	require.False(t, namespaceUpdateIsEcho(nil, newer), "unrecognized old object must not suppress")
	require.False(t, namespaceUpdateIsEcho(older, nil), "unrecognized new object must not suppress")
}

// While the workload stores are SETTLING (tracker not ready) the presence
// signature changes on nearly every ingest batch; unthrottled, that is a
// doorbell (and a client refetch) every debounce tick for the whole initial
// sync (observed live as a fetch storm during cluster warm-up). Presence
// broadcasts are capped at the legacy poll cadence while settling; the
// ready flip itself stays immediate.
func TestNamespaceNotifierThrottlesPresenceBroadcastsWhileSettling(t *testing.T) {
	ingest := &fakeNamespaceIngest{}
	ingest.set(false, "ns-1")
	recorder := &broadcastRecorder{}
	notifier := newNotifierForTest(ingest, recorder)
	notifier.notReadyMinInterval = 250 * time.Millisecond
	defer notifier.Stop()

	// Baseline broadcast.
	notifier.WorkloadChanged()
	waitForBroadcasts(t, recorder, 1)

	// Rapid presence churn while settling: throttled, not one per debounce.
	for i := 0; i < 6; i++ {
		ingest.set(false, "ns-1", fmt.Sprintf("ns-%d", i+2))
		notifier.WorkloadChanged()
		time.Sleep(40 * time.Millisecond)
	}
	// 6 changes over ~240ms with a 250ms floor: at most one more broadcast.
	time.Sleep(60 * time.Millisecond)
	if got := recorder.count(); got > 2 {
		t.Fatalf("settling presence churn must be throttled, got %d broadcasts", got)
	}

	// The throttled change is not lost: it lands once the floor elapses.
	waitForBroadcasts(t, recorder, 2)
}

// Events arriving before the broadcast sink is wired are retained, not lost.
func TestNamespaceNotifierRetainsEventsUntilBroadcastWired(t *testing.T) {
	ingest := &fakeNamespaceIngest{}
	ingest.set(true)
	recorder := &broadcastRecorder{}
	notifier := NewNamespaceChangeNotifier(ingest, NewNamespaceWorkloadTracker(ingest), nil)
	notifier.debounce = 20 * time.Millisecond
	defer notifier.Stop()

	notifier.NamespaceChanged()
	time.Sleep(80 * time.Millisecond)
	require.Equal(t, 0, recorder.count())

	notifier.SetBroadcast(recorder.record)
	waitForBroadcasts(t, recorder, 1)
}
