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
