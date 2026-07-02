package snapshot

import (
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"

	"github.com/luxury-yacht/app/backend/objectcatalog"
)

// fakeNamespaceIngest is a minimal namespacePodIngestSource whose presence rows
// and sync state the tests mutate directly.
type fakeNamespaceIngest struct {
	mu         sync.Mutex
	synced     bool
	workloadNS []string
}

func (f *fakeNamespaceIngest) Tracks(schema.GroupVersionResource) bool { return true }
func (f *fakeNamespaceIngest) HasSyncedFor(schema.GroupVersionResource) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.synced
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
func (f *fakeNamespaceIngest) AggregateRows(schema.GroupVersionResource) []interface{} {
	return nil
}

func (f *fakeNamespaceIngest) set(synced bool, workloadNS ...string) {
	f.mu.Lock()
	f.synced = synced
	f.workloadNS = workloadNS
	f.mu.Unlock()
}

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
	notifier := NewNamespaceChangeNotifier(ingest, NewNamespaceWorkloadTracker(ingest))
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
	require.Contains(t, recorder.lastReason(), "workload presence changed",
		"the broadcast reason must say WHAT rang the doorbell")
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

// Events arriving before the broadcast sink is wired are retained, not lost.
func TestNamespaceNotifierRetainsEventsUntilBroadcastWired(t *testing.T) {
	ingest := &fakeNamespaceIngest{}
	ingest.set(true)
	recorder := &broadcastRecorder{}
	notifier := NewNamespaceChangeNotifier(ingest, NewNamespaceWorkloadTracker(ingest))
	notifier.debounce = 20 * time.Millisecond
	defer notifier.Stop()

	notifier.NamespaceChanged()
	time.Sleep(80 * time.Millisecond)
	require.Equal(t, 0, recorder.count())

	notifier.SetBroadcast(recorder.record)
	waitForBroadcasts(t, recorder, 1)
}
