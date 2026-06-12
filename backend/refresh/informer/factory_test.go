package informer

import (
	"context"
	"errors"
	"fmt"
	"sync/atomic"
	"testing"
	"time"

	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/watch"
	"k8s.io/client-go/kubernetes/fake"
	"k8s.io/client-go/tools/cache"

	"github.com/luxury-yacht/app/backend/refresh/permissions"
)

// brokenInformer returns an informer whose initial list always fails with err,
// so its cache can never sync. Mirrors a Gateway API informer watching a
// version the server does not serve, or an RBAC-forbidden resource.
func brokenInformer(err error) cache.SharedIndexInformer {
	return cache.NewSharedIndexInformer(&cache.ListWatch{
		ListFunc: func(metav1.ListOptions) (runtime.Object, error) {
			return nil, err
		},
		WatchFunc: func(metav1.ListOptions) (watch.Interface, error) {
			return nil, err
		},
	}, &corev1.Pod{}, 0, cache.Indexers{})
}

func newStartedFactory(t *testing.T) *Factory {
	t.Helper()
	checker := permissions.NewCheckerWithReview("test", time.Minute, func(_ context.Context, _, _, _ string) (bool, error) {
		return true, nil
	})
	return New(fake.NewClientset(), nil, time.Minute, checker)
}

func TestStartSettlesWhenInformerCanNeverSync(t *testing.T) {
	factory := newStartedFactory(t)

	notFound := apierrors.NewNotFound(schema.GroupResource{Group: "gateway.networking.k8s.io", Resource: "tlsroutes"}, "")
	broken := brokenInformer(notFound)
	factory.registerInformer(broken)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	go broken.Run(ctx.Done())

	if err := factory.Start(ctx); err != nil {
		t.Fatalf("Start returned error: %v", err)
	}
	if ctx.Err() != nil {
		t.Fatalf("Start only returned because the test context expired")
	}
	if !factory.HasSynced(context.Background()) {
		t.Fatalf("expected factory to report synced when the only unsynced informer can never sync")
	}
}

func TestStartKeepsBlockingOnTransientFailures(t *testing.T) {
	factory := newStartedFactory(t)

	broken := brokenInformer(errors.New("connection refused"))
	factory.registerInformer(broken)

	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()
	go broken.Run(ctx.Done())

	if err := factory.Start(ctx); err == nil {
		t.Fatalf("expected Start to keep blocking while a transiently failing informer is unsynced")
	}
	if factory.HasSynced(context.Background()) {
		t.Fatalf("expected factory to stay unsynced when failures are transient")
	}
}

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

	// Replace syncStates to track registrations.
	factory.syncStatesMu.Lock()
	factory.syncStates = nil
	factory.syncStatesMu.Unlock()

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

func TestIsTerminalWatchError(t *testing.T) {
	notFound := apierrors.NewNotFound(schema.GroupResource{Group: "gateway.networking.k8s.io", Resource: "tlsroutes"}, "")
	forbidden := apierrors.NewForbidden(schema.GroupResource{Resource: "secrets"}, "", errors.New("denied"))
	cases := []struct {
		name     string
		err      error
		terminal bool
	}{
		{"not found", notFound, true},
		{"forbidden", forbidden, true},
		{"wrapped not found (reflector list error)", fmt.Errorf("failed to list *v1.TLSRoute: %w", notFound), true},
		{"unauthorized stays transient for auth recovery", apierrors.NewUnauthorized("expired"), false},
		{"timeout", apierrors.NewServerTimeout(schema.GroupResource{Resource: "pods"}, "list", 1), false},
		{"plain network error", errors.New("connection refused"), false},
	}
	for _, tc := range cases {
		if got := isTerminalWatchError(tc.err); got != tc.terminal {
			t.Errorf("%s: isTerminalWatchError = %v, want %v", tc.name, got, tc.terminal)
		}
	}
}

func newMinimalFactory(checker *permissions.Checker) *Factory {
	return &Factory{
		kubeClient:         fake.NewClientset(),
		permissionAllowed:  make(map[string]struct{}),
		runtimePermissions: checker,
	}
}
