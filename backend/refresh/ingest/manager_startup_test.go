package ingest

import (
	"context"
	"fmt"
	"testing"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	apiruntime "k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/watch"
	"k8s.io/client-go/tools/cache"
)

// TestInitialIngestStartupLaunchesEveryPermittedReflectorImmediately pins the
// startup contract: admission is not a second scheduler layered over client-go.
// Holding every initial LIST open must not prevent any other permitted
// reflector from reaching Kubernetes.
func TestInitialIngestStartupLaunchesEveryPermittedReflectorImmediately(t *testing.T) {
	disableWatchList(t)

	const resourceCount = 9
	started := make(chan schema.GroupVersionResource, resourceCount)
	releases := make([]chan struct{}, 0, resourceCount)
	mgr := &IngestManager{
		entries:      make(map[schema.GroupVersionResource]*entry),
		syncDeadline: time.Hour,
		now:          time.Now,
	}
	for index := range resourceCount {
		gvr := schema.GroupVersionResource{
			Group:    "parallel-start.example.com",
			Version:  "v1",
			Resource: fmt.Sprintf("resources-%02d", index),
		}
		release := make(chan struct{})
		releases = append(releases, release)
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

	receiveStarted(t, started, resourceCount, time.Second)
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
		gvr:   gvr,
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
