package informer

import (
	"context"
	"strings"
	"sync"
	"testing"
	"time"

	authorizationv1 "k8s.io/api/authorization/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/kubernetes/fake"
	k8stesting "k8s.io/client-go/testing"
	"k8s.io/client-go/tools/cache"

	"github.com/luxury-yacht/app/backend/refresh/permissions"
)

func TestNewFactoryRegistersPodNodeIndex(t *testing.T) {
	client := fake.NewClientset()
	factory := New(client, nil, time.Minute, nil)

	podInformer := factory.SharedInformerFactory().Core().V1().Pods().Informer()
	indexers := podInformer.GetIndexer().GetIndexers()
	if _, ok := indexers[podNodeIndexName]; !ok {
		t.Fatalf("expected pod informer to register %q index", podNodeIndexName)
	}
}

func TestCanListResourceCachesResults(t *testing.T) {
	client := fake.NewClientset()
	var sarCalls int
	client.PrependReactor("create", "selfsubjectaccessreviews", func(action k8stesting.Action) (bool, runtime.Object, error) {
		sarCalls++
		review := &authorizationv1.SelfSubjectAccessReview{
			Status: authorizationv1.SubjectAccessReviewStatus{Allowed: true},
		}
		return true, review, nil
	})

	factory := newMinimalFactory(client)

	allowed, err := factory.CanListResource("apps", "deployments")
	if err != nil {
		t.Fatalf("CanListResource returned error: %v", err)
	}
	if !allowed {
		t.Fatalf("expected CanListResource to allow on first call")
	}
	if sarCalls != 1 {
		t.Fatalf("expected exactly one SAR call, got %d", sarCalls)
	}

	allowed, err = factory.CanListResource("apps", "deployments")
	if err != nil {
		t.Fatalf("CanListResource returned error on cached call: %v", err)
	}
	if !allowed {
		t.Fatalf("expected cached call to remain allowed")
	}
	if sarCalls != 1 {
		t.Fatalf("expected cached result to skip SAR, still got %d calls", sarCalls)
	}

	cacheSnapshot := factory.PermissionCacheSnapshot()
	if len(cacheSnapshot) != 1 {
		t.Fatalf("expected permission cache to contain one entry, got %d", len(cacheSnapshot))
	}
}

func TestPrimePermissionsDeduplicatesRequests(t *testing.T) {
	client := fake.NewClientset()
	var sarCalls int
	client.PrependReactor("create", "selfsubjectaccessreviews", func(action k8stesting.Action) (bool, runtime.Object, error) {
		sarCalls++
		review := &authorizationv1.SelfSubjectAccessReview{
			Status: authorizationv1.SubjectAccessReviewStatus{Allowed: true},
		}
		return true, review, nil
	})

	factory := newMinimalFactory(client)

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

	if sarCalls != 2 {
		t.Fatalf("expected two unique SAR calls (list/watch), got %d", sarCalls)
	}

	snapshot := factory.PermissionCacheSnapshot()
	if len(snapshot) != 2 {
		t.Fatalf("expected permission cache to contain two entries, got %d", len(snapshot))
	}
}

func TestProcessPendingClusterInformersSkipsWithoutPermissions(t *testing.T) {
	client := fake.NewClientset()
	// Deny list/watches to ensure informers are not registered.
	client.PrependReactor("create", "selfsubjectaccessreviews", func(action k8stesting.Action) (bool, runtime.Object, error) {
		review := &authorizationv1.SelfSubjectAccessReview{
			Status: authorizationv1.SubjectAccessReviewStatus{Allowed: false},
		}
		return true, review, nil
	})

	factory := newMinimalFactory(client)

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

func TestRuntimePermissionFallbackUsesLegacyCache(t *testing.T) {
	client := fake.NewClientset()

	factory := newMinimalFactory(client)
	logger := &captureLogger{}
	checker := permissions.NewCheckerWithReview("cluster-a", time.Minute, func(context.Context, string, string, string) (bool, error) {
		return false, context.DeadlineExceeded
	})
	factory.storeLegacyPermission("/pods/list", true)
	factory.ConfigureRuntimePermissions(checker, logger)

	allowed, err := factory.CanListResource("", "pods")
	if err != nil {
		t.Fatalf("CanListResource returned error: %v", err)
	}
	if allowed {
		// ok
	} else {
		t.Fatalf("expected fallback to allow based on legacy cache")
	}
	if logger.countWarningsContaining("permission fallback") == 0 {
		t.Fatalf("expected fallback warning to be logged")
	}
}

func TestLegacyPermissionCacheExpires(t *testing.T) {
	client := fake.NewClientset()
	now := time.Now()
	factory := newMinimalFactory(client)
	factory.permissionCacheTTL = time.Minute
	factory.permissionNow = func() time.Time { return now }

	factory.storeLegacyPermission("/pods/list", true)
	if allowed, ok := factory.readLegacyPermission("/pods/list"); !ok || !allowed {
		t.Fatalf("expected legacy permission to be cached")
	}

	now = now.Add(2 * time.Minute)
	if _, ok := factory.readLegacyPermission("/pods/list"); ok {
		t.Fatalf("expected legacy permission cache to expire")
	}

	if snapshot := factory.PermissionCacheSnapshot(); snapshot != nil {
		t.Fatalf("expected expired cache to be evicted")
	}
}

func newMinimalFactory(client kubernetes.Interface) *Factory {
	return &Factory{
		kubeClient:         client,
		permissionCache:    make(map[string]permissionCacheEntry),
		permissionAllowed:  make(map[string]struct{}),
		permissionCacheTTL: time.Minute,
		permissionNow:      time.Now,
	}
}

type captureLogger struct {
	mu       sync.Mutex
	warnings []string
}

func (c *captureLogger) Debug(string, ...string) {}
func (c *captureLogger) Info(string, ...string)  {}
func (c *captureLogger) Error(string, ...string) {}

func (c *captureLogger) Warn(message string, _ ...string) {
	c.mu.Lock()
	c.warnings = append(c.warnings, message)
	c.mu.Unlock()
}

func (c *captureLogger) countWarningsContaining(match string) int {
	c.mu.Lock()
	defer c.mu.Unlock()
	count := 0
	for _, msg := range c.warnings {
		if strings.Contains(msg, match) {
			count++
		}
	}
	return count
}
