package informer

import (
	"context"
	"sync/atomic"
	"testing"
	"time"

	"k8s.io/client-go/kubernetes/fake"
	"k8s.io/client-go/tools/cache"

	"github.com/luxury-yacht/app/backend/refresh/permissions"
)

func TestNewFactoryRegistersPodNodeIndex(t *testing.T) {
	client := fake.NewClientset()
	checker := permissions.NewCheckerWithReview("test", time.Minute, func(_ context.Context, _, _, _ string) (bool, error) {
		return true, nil
	})
	factory := New(client, nil, time.Minute, checker)

	podInformer := factory.SharedInformerFactory().Core().V1().Pods().Informer()
	indexers := podInformer.GetIndexer().GetIndexers()
	if _, ok := indexers[podNodeIndexName]; !ok {
		t.Fatalf("expected pod informer to register %q index", podNodeIndexName)
	}
}

func TestCanListResourceCachesResults(t *testing.T) {
	var sarCalls atomic.Int32
	checker := permissions.NewCheckerWithReview("test", time.Minute, func(_ context.Context, _, _, _ string) (bool, error) {
		sarCalls.Add(1)
		return true, nil
	})

	factory := newMinimalFactory(checker)

	allowed, err := factory.CanListResource("apps", "deployments")
	if err != nil {
		t.Fatalf("CanListResource returned error: %v", err)
	}
	if !allowed {
		t.Fatalf("expected CanListResource to allow on first call")
	}
	if sarCalls.Load() != 1 {
		t.Fatalf("expected exactly one SAR call, got %d", sarCalls.Load())
	}

	// Second call should be served from the Checker's cache.
	allowed, err = factory.CanListResource("apps", "deployments")
	if err != nil {
		t.Fatalf("CanListResource returned error on cached call: %v", err)
	}
	if !allowed {
		t.Fatalf("expected cached call to remain allowed")
	}
	if sarCalls.Load() != 1 {
		t.Fatalf("expected cached result to skip SAR, still got %d calls", sarCalls.Load())
	}
}

func TestPrimePermissionsDeduplicatesRequests(t *testing.T) {
	var sarCalls atomic.Int32
	checker := permissions.NewCheckerWithReview("test", time.Minute, func(_ context.Context, _, _, _ string) (bool, error) {
		sarCalls.Add(1)
		return true, nil
	})

	factory := newMinimalFactory(checker)

	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()

	requests := []PermissionRequest{
		{Group: "", Resource: "nodes", Verb: "list"},
		{Group: "", Resource: "nodes", Verb: "list"},  // duplicate
		{Group: "", Resource: "nodes", Verb: "watch"}, // distinct verb
	}

	if err := factory.PrimePermissions(ctx, requests); err != nil {
		t.Fatalf("PrimePermissions returned error: %v", err)
	}

	if sarCalls.Load() != 2 {
		t.Fatalf("expected two unique SAR calls (list/watch), got %d", sarCalls.Load())
	}
}

func TestProcessPendingClusterInformersSkipsWithoutPermissions(t *testing.T) {
	// Deny everything via the Checker.
	checker := permissions.NewCheckerWithReview("test", time.Minute, func(_ context.Context, _, _, _ string) (bool, error) {
		return false, nil
	})

	factory := newMinimalFactory(checker)

	// Replace syncedFns to track registrations.
	factory.syncedFnsMu.Lock()
	factory.syncedFns = nil
	factory.syncedFnsMu.Unlock()

	called := false
	factory.pendingClusterInformers = []clusterInformerRegistration{
		{
			group:    "",
			resource: "nodes",
			factory: func() cache.SharedIndexInformer {
				called = true
				return cache.NewSharedIndexInformer(nil, nil, 0, cache.Indexers{})
			},
		},
	}

	factory.processPendingClusterInformers()
	if len(factory.pendingClusterInformers) != 0 {
		t.Fatalf("expected pending informers to be cleared")
	}
	if called {
		t.Fatalf("expected informer factory to be skipped when permissions denied")
	}
}

func newMinimalFactory(checker *permissions.Checker) *Factory {
	return &Factory{
		kubeClient:         fake.NewClientset(),
		permissionAllowed:  make(map[string]struct{}),
		runtimePermissions: checker,
	}
}
