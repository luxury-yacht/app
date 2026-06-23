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
	factory.registerInformer("gateway.networking.k8s.io", "tlsroutes", broken)

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

func TestStartDegradesInformerThatNeverSyncsByDeadline(t *testing.T) {
	factory := newStartedFactory(t)
	// A short deadline so the test does not wait on the production default.
	factory.syncDeadline = 100 * time.Millisecond

	// A transient failure never goes terminal, so without the deadline it would
	// block readiness forever (mirrors a WatchList stream whose terminal bookmark
	// is stripped — the reflector never reports HasSynced).
	hung := brokenInformer(errors.New("connection refused"))
	factory.registerInformer("gateway.networking.k8s.io", "tlsroutes", hung)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	go hung.Run(ctx.Done())

	if err := factory.Start(ctx); err != nil {
		t.Fatalf("Start returned error: %v", err)
	}
	if ctx.Err() != nil {
		t.Fatalf("Start only returned because the test context expired — the hung informer was not degraded")
	}
	if !factory.HasSynced(context.Background()) {
		t.Fatalf("expected the factory to reach readiness once the hung informer is degraded")
	}
	if !factory.ResourcesSettled([]string{"core/pods"}) {
		t.Fatalf("expected unrelated resources to be settled")
	}
	// The hung resource itself is reported settled (degraded counts as settled so
	// it stops gating readiness).
	if !factory.ResourcesSettled([]string{"gateway.networking.k8s.io/tlsroutes"}) {
		t.Fatalf("expected the degraded resource to be reported settled so it no longer blocks readiness")
	}
}

func TestStartKeepsBlockingOnTransientFailures(t *testing.T) {
	factory := newStartedFactory(t)

	broken := brokenInformer(errors.New("connection refused"))
	factory.registerInformer("gateway.networking.k8s.io", "tlsroutes", broken)

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

func TestResourcesSettledIsolatesPendingKeys(t *testing.T) {
	factory := newStartedFactory(t)

	transient := brokenInformer(errors.New("connection refused"))
	factory.registerInformer("gateway.networking.k8s.io", "tlsroutes", transient)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	go transient.Run(ctx.Done())
	go func() { _ = factory.Start(ctx) }()

	// The fake-client informers settle while the transient one stays pending —
	// the per-domain win in miniature.
	deadline := time.Now().Add(5 * time.Second)
	for !factory.ResourcesSettled([]string{"core/pods"}) {
		if time.Now().After(deadline) {
			t.Fatalf("expected core/pods to settle while an unrelated informer is pending")
		}
		time.Sleep(10 * time.Millisecond)
	}

	if factory.ResourcesSettled([]string{"gateway.networking.k8s.io/tlsroutes"}) {
		t.Fatalf("expected the pending informer to block its own key")
	}
	if factory.ResourcesSettled([]string{"core/pods", "gateway.networking.k8s.io/tlsroutes"}) {
		t.Fatalf("expected one pending key to block the combined set")
	}
}

func TestResourcesSettledTreatsTerminalAsSettled(t *testing.T) {
	factory := newStartedFactory(t)

	notFound := apierrors.NewNotFound(schema.GroupResource{Group: "gateway.networking.k8s.io", Resource: "tlsroutes"}, "")
	broken := brokenInformer(notFound)
	factory.registerInformer("gateway.networking.k8s.io", "tlsroutes", broken)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	go broken.Run(ctx.Done())

	deadline := time.Now().Add(10 * time.Second)
	for !factory.ResourcesSettled([]string{"gateway.networking.k8s.io/tlsroutes"}) {
		if time.Now().After(deadline) {
			t.Fatalf("expected a terminally failed informer to settle its key")
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func TestResourcesSettledUnknownKeyIsSettled(t *testing.T) {
	factory := newStartedFactory(t)
	// A resource with no registered informer (skipped for permissions or never
	// present) has nothing to wait for.
	if !factory.ResourcesSettled([]string{"gateway.networking.k8s.io/grpcroutes"}) {
		t.Fatalf("expected a key with no registered informer to be settled")
	}
}

func TestResourcesSettledFalseAfterShutdown(t *testing.T) {
	factory := newStartedFactory(t)
	if err := factory.Shutdown(); err != nil {
		t.Fatalf("Shutdown returned error: %v", err)
	}
	// Mirror HasSynced: a shut-down factory must block, not default open.
	if factory.ResourcesSettled([]string{"core/pods"}) {
		t.Fatalf("expected a shut-down factory to report unsettled")
	}
}

// TestNewFactoryDoesNotRegisterPodInformer is the factory-side memory proof for the pod
// cut: pods is an owned-reflector ingest kind, so New must NOT register a typed pod
// informer (which would otherwise be the dominant-memory typed cache). The shared
// factory has no core/pods sync state — the pod store's readiness comes from the ingest
// manager via the composite hub. The ReplicaSet informer stays registered (the pod
// projector resolves owners through it), so this asserts the cut is precise.
func TestNewFactoryDoesNotRegisterPodInformer(t *testing.T) {
	client := fake.NewClientset()
	checker := permissions.NewCheckerWithReview("test", time.Minute, func(_ context.Context, _, _, _ string) (bool, error) {
		return true, nil
	})
	factory := New(client, nil, time.Minute, checker)

	factory.syncStatesMu.Lock()
	keys := make(map[string]struct{}, len(factory.syncStates))
	for _, state := range factory.syncStates {
		keys[state.key] = struct{}{}
	}
	factory.syncStatesMu.Unlock()

	if _, ok := keys["core/pods"]; ok {
		t.Fatal("expected no core/pods informer registered: pods is cut to the ingest path")
	}
	if _, ok := keys["apps/replicasets"]; !ok {
		t.Fatal("expected apps/replicasets informer to remain registered for pod owner resolution")
	}
}

// TestNewFactoryDoesNotRegisterWorkloadInformers is the memory proof for the workload cut:
// Deployment/StatefulSet/DaemonSet/Job/CronJob are owned-reflector ingest kinds, so the
// shared factory must NOT instantiate a typed informer for any of them. ReplicaSet is NOT
// cut and its informer must remain (the pod projector resolves the Deployment owner through
// it and the pod stream re-broadcasts pods on RS changes).
func TestNewFactoryDoesNotRegisterWorkloadInformers(t *testing.T) {
	client := fake.NewClientset()
	checker := permissions.NewCheckerWithReview("test", time.Minute, func(_ context.Context, _, _, _ string) (bool, error) {
		return true, nil
	})
	factory := New(client, nil, time.Minute, checker)

	factory.syncStatesMu.Lock()
	keys := make(map[string]struct{}, len(factory.syncStates))
	for _, state := range factory.syncStates {
		keys[state.key] = struct{}{}
	}
	factory.syncStatesMu.Unlock()

	for _, cut := range []string{
		"apps/deployments", "apps/statefulsets", "apps/daemonsets",
		"batch/jobs", "batch/cronjobs",
	} {
		if _, ok := keys[cut]; ok {
			t.Fatalf("expected no %s informer registered: the workload kinds are cut to the ingest path", cut)
		}
	}
	if _, ok := keys["apps/replicasets"]; !ok {
		t.Fatal("expected apps/replicasets informer to remain registered (not cut)")
	}
}

// TestNewFactoryDoesNotRegisterNetworkInformers is the memory proof for the network cut:
// Service, EndpointSlice, Ingress, and NetworkPolicy are owned-reflector ingest kinds, so
// the shared factory must NOT instantiate a typed informer for any of them — their rows,
// catalog, object-map, and notify all come from the ingest reflectors instead.
func TestNewFactoryDoesNotRegisterNetworkInformers(t *testing.T) {
	client := fake.NewClientset()
	checker := permissions.NewCheckerWithReview("test", time.Minute, func(_ context.Context, _, _, _ string) (bool, error) {
		return true, nil
	})
	factory := New(client, nil, time.Minute, checker)

	factory.syncStatesMu.Lock()
	keys := make(map[string]struct{}, len(factory.syncStates))
	for _, state := range factory.syncStates {
		keys[state.key] = struct{}{}
	}
	factory.syncStatesMu.Unlock()

	for _, cut := range []string{
		"core/services",
		"discovery.k8s.io/endpointslices",
		"networking.k8s.io/ingresses",
		"networking.k8s.io/networkpolicies",
	} {
		if _, ok := keys[cut]; ok {
			t.Fatalf("expected no %s informer registered: the network kinds are cut to the ingest path", cut)
		}
	}
}

// TestNewFactoryDoesNotRegisterNodeInformer is the memory proof for the node cut: Node is an
// owned-reflector ingest kind, so the shared factory must NOT instantiate a typed node informer
// — its OWN-rows, overview facts, catalog, object-map, and notify all come from the ingest
// reflector instead. The win is the large .status.images list every node object carries, which
// no consumer reads and the projection drops.
func TestNewFactoryDoesNotRegisterNodeInformer(t *testing.T) {
	client := fake.NewClientset()
	checker := permissions.NewCheckerWithReview("test", time.Minute, func(_ context.Context, _, _, _ string) (bool, error) {
		return true, nil
	})
	factory := New(client, nil, time.Minute, checker)

	factory.syncStatesMu.Lock()
	keys := make(map[string]struct{}, len(factory.syncStates))
	for _, state := range factory.syncStates {
		keys[state.key] = struct{}{}
	}
	factory.syncStatesMu.Unlock()

	if _, ok := keys["core/nodes"]; ok {
		t.Fatal("expected no core/nodes informer registered: nodes are cut to the ingest path")
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

func TestNewFactoryRegistersHelmStorageNotFullConfigInformers(t *testing.T) {
	client := fake.NewClientset()
	checker := permissions.NewCheckerWithReview("test", time.Minute, func(_ context.Context, _, _, _ string) (bool, error) {
		return true, nil
	})
	factory := New(client, nil, time.Minute, checker)

	// configmaps + secrets are cut to the ingest path: the shared factory must not
	// register a full informer for either, but the helm-storage source DOES register
	// a label-filtered (owner=helm) informer for each under the same readiness key.
	helm := factory.HelmStorage()
	if helm == nil {
		t.Fatal("expected helm-storage source to be wired")
	}
	if helm.SecretInformer() == nil {
		t.Fatal("expected helm-storage Secret informer")
	}
	if helm.ConfigMapInformer() == nil {
		t.Fatal("expected helm-storage ConfigMap informer")
	}
	if helm.SecretLister() == nil {
		t.Fatal("expected helm-storage Secret lister for the namespace-helm builder")
	}

	factory.syncStatesMu.Lock()
	defer factory.syncStatesMu.Unlock()
	secretStates := 0
	configStates := 0
	for _, state := range factory.syncStates {
		switch state.key {
		case "core/secrets":
			secretStates++
		case "core/configmaps":
			configStates++
		}
	}
	// Exactly one informer per kind: the helm-storage filtered informer. A second
	// (the removed full informer) would mean the typed object is still cached.
	if secretStates != 1 {
		t.Fatalf("expected exactly one core/secrets informer (helm-storage filtered), got %d", secretStates)
	}
	if configStates != 1 {
		t.Fatalf("expected exactly one core/configmaps informer (helm-storage filtered), got %d", configStates)
	}
}

// TestHelmStorageSourceSkipsDeniedKinds proves the helm-storage source creates no
// filtered informer for a kind the identity cannot list/watch — a denied secret
// never opens a watch — and reports synced so the helm builder serves empty.
func TestHelmStorageSourceSkipsDeniedKinds(t *testing.T) {
	client := fake.NewClientset()
	checker := permissions.NewCheckerWithReview("test", time.Minute, func(_ context.Context, _, resource, _ string) (bool, error) {
		return resource != "secrets", nil
	})
	factory := New(client, nil, time.Minute, checker)

	helm := factory.HelmStorage()
	if helm == nil {
		t.Fatal("expected helm-storage source to be wired")
	}
	if helm.SecretInformer() != nil {
		t.Fatal("expected no helm-storage Secret informer when secrets are denied")
	}
	if !helm.SecretsHasSynced()() {
		t.Fatal("expected SecretsHasSynced to report synced when no secret informer was created")
	}
	if helm.ConfigMapInformer() == nil {
		t.Fatal("expected helm-storage ConfigMap informer when configmaps are allowed")
	}
}

func newMinimalFactory(checker *permissions.Checker) *Factory {
	return &Factory{
		kubeClient:         fake.NewClientset(),
		permissionAllowed:  make(map[string]struct{}),
		runtimePermissions: checker,
	}
}
