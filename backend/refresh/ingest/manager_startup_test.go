package ingest

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/internal/config"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	apiruntime "k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/watch"
	"k8s.io/client-go/tools/cache"
	"k8s.io/client-go/util/watchlist"
)

// TestInitialIngestStartupIsBoundedAndWorkloadFirst reproduces the cold-start
// request burst: every initial LIST is held open so the test can observe how
// many reflectors Start allows to reach Kubernetes concurrently. Workload data
// must occupy the bounded first wave; releasing one slot must advance the queue.
func TestInitialIngestStartupIsBoundedAndWorkloadFirst(t *testing.T) {
	disableWatchList(t)

	priority := initialIngestPriorityGVRs()
	if len(priority) == 0 {
		t.Fatal("canonical workloads composition produced no ingest-owned priority resources")
	}
	queued := make([]schema.GroupVersionResource, config.RefreshIngestInitialSyncConcurrency+1)
	for i := range queued {
		queued[i] = schema.GroupVersionResource{
			Group:    "startup-test.example.com",
			Version:  "v1",
			Resource: fmt.Sprintf("resources-%02d", i),
		}
	}
	launchOrder := append(append([]schema.GroupVersionResource(nil), priority...), queued...)

	started := make(chan schema.GroupVersionResource, len(launchOrder))
	releases := make(map[schema.GroupVersionResource]chan struct{}, len(launchOrder))
	mgr := &IngestManager{
		entries:      make(map[schema.GroupVersionResource]*entry),
		syncDeadline: time.Hour,
		now:          time.Now,
	}
	for _, gvr := range launchOrder {
		release := make(chan struct{})
		releases[gvr] = release
		mgr.entries[gvr] = blockingStartupEntry(gvr, started, release)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	defer func() {
		for _, release := range releases {
			close(release)
		}
	}()
	mgr.Start(ctx)
	for gvr, tracked := range mgr.entries {
		if tracked.gvr != gvr {
			t.Fatalf("diagnostic identity = %s, want registered resource %s", tracked.gvr, gvr)
		}
	}

	firstWaveCount := config.RefreshIngestInitialSyncConcurrency
	got := receiveStarted(t, started, firstWaveCount, time.Second)
	if extra := receiveOptional(started, 150*time.Millisecond); extra != nil {
		t.Fatalf("initial ingest launched more than %d concurrent requests; unexpected %s", firstWaveCount, *extra)
	}
	firstWave := make(map[schema.GroupVersionResource]bool, len(got))
	for _, gvr := range got {
		firstWave[gvr] = true
	}
	for _, want := range launchOrder[:firstWaveCount] {
		if !firstWave[want] {
			t.Fatalf("initial request wave %v does not include workload-priority %s", got, want)
		}
	}

	close(releases[launchOrder[0]])
	delete(releases, launchOrder[0])
	if next := receiveStarted(t, started, 1, time.Second)[0]; next != launchOrder[firstWaveCount] {
		t.Fatalf("first queued request = %s, want %s", next, launchOrder[firstWaveCount])
	}
}

func TestInitialIngestWorkloadPriorityUsesListThenWatch(t *testing.T) {
	for _, gvr := range initialIngestPriorityGVRs() {
		lw := newInitialIngestListWatcher(gvr, &cache.ListWatch{}, struct{}{})
		if !watchlist.DoesClientNotSupportWatchListSemantics(lw) {
			t.Errorf("priority resource %s allows WatchList, want ordinary LIST followed by WATCH", gvr)
		}
	}

	nonPriority := schema.GroupVersionResource{Group: "example.com", Version: "v1", Resource: "widgets"}
	lw := newInitialIngestListWatcher(nonPriority, &cache.ListWatch{}, struct{}{})
	if watchlist.DoesClientNotSupportWatchListSemantics(lw) {
		t.Fatalf("non-priority resource %s disables WatchList, want the client capability policy preserved", nonPriority)
	}
}

func TestInitialIngestDiagnosticsSeparateQueueWaitFromActiveSync(t *testing.T) {
	disableWatchList(t)

	firstGVR := schema.GroupVersionResource{Group: "diagnostics.example.com", Version: "v1", Resource: "a-first"}
	secondGVR := schema.GroupVersionResource{Group: "diagnostics.example.com", Version: "v1", Resource: "b-second"}
	started := make(chan schema.GroupVersionResource, 2)
	firstRelease := make(chan struct{})
	secondRelease := make(chan struct{})
	mgr := &IngestManager{
		meta:                   testMeta,
		entries:                make(map[schema.GroupVersionResource]*entry),
		syncDeadline:           time.Hour,
		now:                    time.Now,
		initialSyncConcurrency: 1,
	}
	mgr.entries[firstGVR] = blockingStartupEntry(firstGVR, started, firstRelease)
	mgr.entries[secondGVR] = blockingStartupEntry(secondGVR, started, secondRelease)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	defer close(secondRelease)
	mgr.Start(ctx)
	if got := receiveStarted(t, started, 1, time.Second)[0]; got != firstGVR {
		t.Fatalf("first request = %s, want %s", got, firstGVR)
	}

	diagnostics := diagnosticsByGVR(mgr.initialSyncDiagnostics())
	if got := diagnostics[firstGVR].Phase; got != initialSyncPhaseActive {
		t.Fatalf("first phase = %q, want %q", got, initialSyncPhaseActive)
	}
	if got := diagnostics[secondGVR].Phase; got != initialSyncPhaseQueued {
		t.Fatalf("second phase = %q, want %q", got, initialSyncPhaseQueued)
	}
	if diagnostics[firstGVR].QueuePosition != 0 || diagnostics[secondGVR].QueuePosition != 1 {
		t.Fatalf("queue positions = first:%d second:%d, want 0 and 1",
			diagnostics[firstGVR].QueuePosition, diagnostics[secondGVR].QueuePosition)
	}

	close(firstRelease)
	if got := receiveStarted(t, started, 1, time.Second)[0]; got != secondGVR {
		t.Fatalf("second request = %s, want %s", got, secondGVR)
	}
	diagnostics = diagnosticsByGVR(mgr.initialSyncDiagnostics())
	if got := diagnostics[firstGVR].Phase; got != initialSyncPhaseSynced {
		t.Fatalf("first phase after releasing its LIST = %q, want %q", got, initialSyncPhaseSynced)
	}
	if diagnostics[secondGVR].QueueWait <= 0 {
		t.Fatalf("second queue wait = %v, want a positive duration", diagnostics[secondGVR].QueueWait)
	}
}

func TestInitialIngestDiagnosticsRecordListAndWatchListAttempts(t *testing.T) {
	telemetry := newInitialIngestTaskTelemetry()
	list := &corev1.ConfigMapList{
		ListMeta: metav1.ListMeta{ResourceVersion: "1"},
		Items:    []corev1.ConfigMap{{ObjectMeta: metav1.ObjectMeta{Name: "one"}}, {ObjectMeta: metav1.ObjectMeta{Name: "two"}}},
	}
	lw := &cache.ListWatch{
		ListWithContextFunc: func(context.Context, metav1.ListOptions) (apiruntime.Object, error) {
			return list, nil
		},
		WatchFuncWithContext: func(context.Context, metav1.ListOptions) (watch.Interface, error) {
			return watch.NewRaceFreeFake(), nil
		},
	}
	wrapped := newStartupDiagnosticListerWatcher(lw, telemetry, time.Now)
	if _, err := wrapped.List(metav1.ListOptions{}); err != nil {
		t.Fatalf("List: %v", err)
	}
	sendInitialEvents := true
	w, err := wrapped.Watch(metav1.ListOptions{SendInitialEvents: &sendInitialEvents})
	if err != nil {
		t.Fatalf("WatchList: %v", err)
	}
	w.Stop()

	request := telemetry.requestSnapshot()
	if request.ListAttempts != 1 || request.WatchListAttempts != 1 {
		t.Fatalf("request attempts = list:%d watchlist:%d, want 1 and 1", request.ListAttempts, request.WatchListAttempts)
	}
	if request.LastListItems != 2 {
		t.Fatalf("last LIST items = %d, want 2", request.LastListItems)
	}
	if request.LastError != "" {
		t.Fatalf("last request error = %q, want empty", request.LastError)
	}
}

func TestInitialIngestDiagnosticsIdentifyBlockedRequestCall(t *testing.T) {
	telemetry := newInitialIngestTaskTelemetry()
	requestStarted := make(chan struct{})
	releaseRequest := make(chan struct{})
	lw := &cache.ListWatch{
		ListWithContextFunc: func(ctx context.Context, _ metav1.ListOptions) (apiruntime.Object, error) {
			close(requestStarted)
			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			case <-releaseRequest:
				return &corev1.ConfigMapList{}, nil
			}
		},
	}
	wrapped := newStartupDiagnosticListerWatcher(lw, telemetry, time.Now)
	requestDone := make(chan error, 1)
	go func() {
		_, err := wrapped.List(metav1.ListOptions{})
		requestDone <- err
	}()
	<-requestStarted

	if got := telemetry.requestSnapshot().InFlight; got != 1 {
		t.Fatalf("in-flight requests while LIST is blocked = %d, want 1", got)
	}
	close(releaseRequest)
	if err := <-requestDone; err != nil {
		t.Fatalf("List: %v", err)
	}
	if got := telemetry.requestSnapshot().InFlight; got != 0 {
		t.Fatalf("in-flight requests after LIST returns = %d, want 0", got)
	}
}

func TestInitialIngestDiagnosticsPreserveQueuedAtDeadlineAndLateRecovery(t *testing.T) {
	disableWatchList(t)

	firstGVR := schema.GroupVersionResource{Group: "deadline.example.com", Version: "v1", Resource: "a-active"}
	secondGVR := schema.GroupVersionResource{Group: "deadline.example.com", Version: "v1", Resource: "b-queued"}
	started := make(chan schema.GroupVersionResource, 2)
	firstRelease := make(chan struct{})
	secondRelease := make(chan struct{})
	const deadline = 25 * time.Millisecond
	mgr := &IngestManager{
		meta:                   testMeta,
		entries:                make(map[schema.GroupVersionResource]*entry),
		syncDeadline:           deadline,
		now:                    time.Now,
		initialSyncConcurrency: 1,
	}
	mgr.entries[firstGVR] = blockingStartupEntry(firstGVR, started, firstRelease)
	mgr.entries[secondGVR] = blockingStartupEntry(secondGVR, started, secondRelease)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	defer close(secondRelease)
	mgr.Start(ctx)
	if got := receiveStarted(t, started, 1, time.Second)[0]; got != firstGVR {
		t.Fatalf("first request = %s, want %s", got, firstGVR)
	}
	time.Sleep(deadline + 10*time.Millisecond)
	if !mgr.HasSynced() {
		t.Fatal("manager must settle as degraded after the startup deadline")
	}

	diagnostics := diagnosticsByGVR(mgr.initialSyncDiagnostics())
	if !diagnostics[secondGVR].QueuedAtDeadline {
		t.Fatalf("queued task diagnostic = %#v, want queued-at-deadline evidence", diagnostics[secondGVR])
	}
	if !diagnostics[firstGVR].Degraded || !diagnostics[secondGVR].Degraded {
		t.Fatalf("degraded flags = first:%t second:%t, want both true",
			diagnostics[firstGVR].Degraded, diagnostics[secondGVR].Degraded)
	}

	if got := receiveStarted(t, started, 1, time.Second)[0]; got != secondGVR {
		t.Fatalf("post-deadline request = %s, want %s", got, secondGVR)
	}
	close(firstRelease)
	requireDiagnosticPhase(t, mgr, firstGVR, initialSyncPhaseSynced)
	diagnostics = diagnosticsByGVR(mgr.initialSyncDiagnostics())
	if !diagnostics[firstGVR].DeadlineReleased {
		t.Fatalf("recovered task diagnostic = %#v, want deadline release retained", diagnostics[firstGVR])
	}
}

func requireDiagnosticPhase(
	t *testing.T,
	mgr *IngestManager,
	gvr schema.GroupVersionResource,
	want initialSyncPhase,
) {
	t.Helper()
	deadline := time.NewTimer(time.Second)
	defer deadline.Stop()
	ticker := time.NewTicker(10 * time.Millisecond)
	defer ticker.Stop()
	for {
		if got := diagnosticsByGVR(mgr.initialSyncDiagnostics())[gvr].Phase; got == want {
			return
		}
		select {
		case <-deadline.C:
			t.Fatalf("diagnostic phase for %s did not become %q", gvr, want)
		case <-ticker.C:
		}
	}
}

func diagnosticsByGVR(diagnostics []initialSyncDiagnostic) map[schema.GroupVersionResource]initialSyncDiagnostic {
	result := make(map[schema.GroupVersionResource]initialSyncDiagnostic, len(diagnostics))
	for _, diagnostic := range diagnostics {
		result[diagnostic.GVR] = diagnostic
	}
	return result
}

func blockingStartupEntry(
	gvr schema.GroupVersionResource,
	started chan<- schema.GroupVersionResource,
	release <-chan struct{},
) *entry {
	store := NewProjectingStore(func(obj interface{}) (interface{}, error) { return obj, nil })
	view := store.PartitionView("")
	lw := &cache.ListWatch{
		ListWithContextFunc: func(ctx context.Context, _ metav1.ListOptions) (apiruntime.Object, error) {
			started <- gvr
			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			case <-release:
				return &corev1.ConfigMapList{ListMeta: metav1.ListMeta{ResourceVersion: "1"}}, nil
			}
		},
		WatchFuncWithContext: func(context.Context, metav1.ListOptions) (watch.Interface, error) {
			return watch.NewRaceFreeFake(), nil
		},
	}
	return &entry{
		store: store,
		parts: []*ingestPart{{
			lw:        lw,
			reflector: NewProjectingReflector(gvr.String(), lw, &corev1.ConfigMap{}, view, resyncDisabled),
			view:      view,
		}},
	}
}

func receiveStarted(t *testing.T, started <-chan schema.GroupVersionResource, count int, timeout time.Duration) []schema.GroupVersionResource {
	t.Helper()
	got := make([]schema.GroupVersionResource, 0, count)
	timer := time.NewTimer(timeout)
	defer timer.Stop()
	for len(got) < count {
		select {
		case gvr := <-started:
			got = append(got, gvr)
		case <-timer.C:
			t.Fatalf("only %d of %d expected initial requests started: %v", len(got), count, got)
		}
	}
	return got
}

func receiveOptional(started <-chan schema.GroupVersionResource, timeout time.Duration) *schema.GroupVersionResource {
	timer := time.NewTimer(timeout)
	defer timer.Stop()
	select {
	case gvr := <-started:
		return &gvr
	case <-timer.C:
		return nil
	}
}
