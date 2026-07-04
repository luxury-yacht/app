/*
 * backend/objectcatalog/sync_test.go
 *
 * Catalog sync and capability evaluation tests.
 */

package objectcatalog

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/capabilities"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
	"github.com/luxury-yacht/app/backend/resources/common"
	authorizationv1 "k8s.io/api/authorization/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/discovery"
	fakediscovery "k8s.io/client-go/discovery/fake"
	dynamicfake "k8s.io/client-go/dynamic/fake"
	"k8s.io/client-go/informers"
	kubernetesfake "k8s.io/client-go/kubernetes/fake"
	k8stesting "k8s.io/client-go/testing"
)

type recordingTelemetryEntry struct {
	enabled       bool
	itemCount     int
	resourceCount int
	duration      time.Duration
	err           error
}

type recordingTelemetry struct {
	mu      sync.Mutex
	entries []recordingTelemetryEntry
}

func (r *recordingTelemetry) RecordCatalog(enabled bool, itemCount, resourceCount int, duration time.Duration, err error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.entries = append(r.entries, recordingTelemetryEntry{enabled: enabled, itemCount: itemCount, resourceCount: resourceCount, duration: duration, err: err})
}

func (r *recordingTelemetry) last() recordingTelemetryEntry {
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(r.entries) == 0 {
		return recordingTelemetryEntry{}
	}
	return r.entries[len(r.entries)-1]
}

type preferredDiscovery struct {
	*fakediscovery.FakeDiscovery
	resources []*metav1.APIResourceList
}

func (p *preferredDiscovery) ServerPreferredResources() ([]*metav1.APIResourceList, error) {
	return p.resources, nil
}

type discoveryOverrideClient struct {
	*kubernetesfake.Clientset
	discovery discovery.DiscoveryInterface
}

func (c *discoveryOverrideClient) Discovery() discovery.DiscoveryInterface {
	return c.discovery
}

func TestEnsureDependenciesFailures(t *testing.T) {
	svc := NewService(Dependencies{}, nil)
	if err := svc.ensureDependencies(); err == nil {
		t.Fatalf("expected error when kubernetes client missing")
	}

	deps := Dependencies{Common: common.Dependencies{KubernetesClient: kubernetesfake.NewClientset()}}
	svc = NewService(deps, nil)
	if err := svc.ensureDependencies(); err == nil {
		t.Fatalf("expected error when dynamic client missing")
	}

	dyn := dynamicfake.NewSimpleDynamicClient(runtime.NewScheme())
	deps = Dependencies{Common: common.Dependencies{
		KubernetesClient: kubernetesfake.NewClientset(),
		DynamicClient:    dyn,
		EnsureClient: func(string) error {
			return errors.New("boom")
		},
	}}
	svc = NewService(deps, nil)
	if err := svc.ensureDependencies(); err == nil {
		t.Fatalf("expected ensureClient error to propagate")
	}
}

func TestEvaluateDescriptorNilService(t *testing.T) {
	svc := NewService(Dependencies{Common: common.Dependencies{}}, nil)
	desc := resourceDescriptor{Kind: "Deployment"}
	allowed, err := svc.evaluateDescriptor(context.Background(), nil, desc)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !allowed {
		t.Fatalf("expected descriptor to be allowed when capability service is nil")
	}
}

func TestEvaluateDescriptorRespectsCapabilityResults(t *testing.T) {
	client := kubernetesfake.NewClientset()
	client.PrependReactor("create", "selfsubjectaccessreviews", func(action k8stesting.Action) (handled bool, ret runtime.Object, err error) {
		review := action.(k8stesting.CreateAction).GetObject().(*authorizationv1.SelfSubjectAccessReview)
		result := review.DeepCopy()
		switch review.Spec.ResourceAttributes.Resource {
		case "deployments":
			result.Status.Allowed = true
		case "statefulsets":
			result.Status.Allowed = false
		}
		return true, result, nil
	})

	factory := func() *capabilities.Service {
		return capabilities.NewService(capabilities.Dependencies{
			Common: common.Dependencies{
				KubernetesClient: client,
				EnsureClient:     func(string) error { return nil },
			},
		})
	}

	deps := Dependencies{
		Common: common.Dependencies{
			KubernetesClient: client,
			EnsureClient:     func(string) error { return nil },
		},
		CapabilityFactory: factory,
	}

	svc := NewService(deps, nil)
	capSvc := factory()

	deployDesc := resourceDescriptor{Resource: "deployments", Group: "apps", Version: "v1", GVR: schema.GroupVersionResource{Group: "apps", Version: "v1", Resource: "deployments"}}
	allowed, err := svc.evaluateDescriptor(context.Background(), capSvc, deployDesc)
	if err != nil {
		t.Fatalf("unexpected error evaluating deployments: %v", err)
	}
	if !allowed {
		t.Fatalf("expected deployments to be allowed")
	}

	statefulDesc := resourceDescriptor{Resource: "statefulsets", Group: "apps", Version: "v1", GVR: schema.GroupVersionResource{Group: "apps", Version: "v1", Resource: "statefulsets"}}
	allowed, err = svc.evaluateDescriptor(context.Background(), capSvc, statefulDesc)
	if err != nil {
		t.Fatalf("unexpected error evaluating statefulsets: %v", err)
	}
	if allowed {
		t.Fatalf("expected statefulsets to be denied")
	}

	batchAllowed, batchErrors, err := svc.evaluateDescriptorsBatch(context.Background(), capSvc, []resourceDescriptor{deployDesc, statefulDesc})
	if err != nil {
		t.Fatalf("batch evaluation failed: %v", err)
	}
	if !batchAllowed[0] {
		t.Fatalf("expected deployments to be allowed in batch preflight")
	}
	if batchAllowed[1] {
		t.Fatalf("expected statefulsets to be denied in batch preflight")
	}
	if len(batchErrors) != 0 {
		t.Fatalf("expected no errors in batch evaluation, got %+v", batchErrors)
	}
}

func TestEvaluateDescriptorPropagatesErrors(t *testing.T) {
	client := kubernetesfake.NewClientset()
	client.PrependReactor("create", "selfsubjectaccessreviews", func(k8stesting.Action) (bool, runtime.Object, error) {
		return true, nil, errors.New("sar failure")
	})

	factory := func() *capabilities.Service {
		return capabilities.NewService(capabilities.Dependencies{
			Common: common.Dependencies{
				KubernetesClient: client,
				EnsureClient: func(resource string) error {
					if resource == "SelfSubjectAccessReview" {
						return nil
					}
					return errors.New("unexpected ensure call")
				},
			},
		})
	}

	svc := NewService(Dependencies{CapabilityFactory: factory}, nil)
	capSvc := factory()
	allowed, err := svc.evaluateDescriptor(context.Background(), capSvc, resourceDescriptor{
		Resource: "deployments",
		GVR:      schema.GroupVersionResource{Group: "apps", Version: "v1", Resource: "deployments"},
	})
	if err == nil {
		t.Fatalf("expected evaluation error when SAR call fails")
	}
	if allowed {
		t.Fatalf("expected descriptor to be denied when SAR errors")
	}

	_, batchErrors, batchErr := svc.evaluateDescriptorsBatch(context.Background(), capSvc, []resourceDescriptor{
		{Resource: "deployments", GVR: schema.GroupVersionResource{Group: "apps", Version: "v1", Resource: "deployments"}},
	})
	if batchErr == nil {
		t.Fatalf("expected batch evaluation to return error when SAR fails")
	}
	if len(batchErrors) != 0 {
		t.Fatalf("expected no partial error map when batch evaluation fails, got %+v", batchErrors)
	}
}

func TestSyncRetainsDataOnPartialFailure(t *testing.T) {
	ctx := context.Background()
	scheme := runtime.NewScheme()
	deployGVK := schema.GroupVersionKind{Group: "apps", Version: "v1", Kind: "Deployment"}
	statefulGVK := schema.GroupVersionKind{Group: "apps", Version: "v1", Kind: "StatefulSet"}
	scheme.AddKnownTypeWithName(deployGVK, &unstructured.Unstructured{})
	scheme.AddKnownTypeWithName(deployGVK.GroupVersion().WithKind("DeploymentList"), &unstructured.UnstructuredList{})
	scheme.AddKnownTypeWithName(statefulGVK, &unstructured.Unstructured{})
	scheme.AddKnownTypeWithName(statefulGVK.GroupVersion().WithKind("StatefulSetList"), &unstructured.UnstructuredList{})

	listKinds := map[schema.GroupVersionResource]string{
		{Group: "apps", Version: "v1", Resource: "deployments"}:  "DeploymentList",
		{Group: "apps", Version: "v1", Resource: "statefulsets"}: "StatefulSetList",
	}

	dyn := dynamicfake.NewSimpleDynamicClientWithCustomListKinds(scheme, listKinds)

	deployGVR := schema.GroupVersionResource{Group: "apps", Version: "v1", Resource: "deployments"}
	deployObj := &unstructured.Unstructured{}
	deployObj.SetGroupVersionKind(deployGVK)
	deployObj.SetNamespace("default")
	deployObj.SetName("deploy-demo")
	if _, err := dyn.Resource(deployGVR).Namespace("default").Create(ctx, deployObj, metav1.CreateOptions{}); err != nil {
		t.Fatalf("failed to seed deployment: %v", err)
	}

	statefulGVR := schema.GroupVersionResource{Group: "apps", Version: "v1", Resource: "statefulsets"}
	statefulObj := &unstructured.Unstructured{}
	statefulObj.SetGroupVersionKind(statefulGVK)
	statefulObj.SetNamespace("default")
	statefulObj.SetName("stateful-alpha")
	if _, err := dyn.Resource(statefulGVR).Namespace("default").Create(ctx, statefulObj, metav1.CreateOptions{}); err != nil {
		t.Fatalf("failed to seed statefulset: %v", err)
	}

	shouldFailStateful := false
	dyn.PrependReactor("list", "statefulsets", func(k8stesting.Action) (bool, runtime.Object, error) {
		if shouldFailStateful {
			return true, nil, errors.New("statefulset list failure")
		}
		return false, nil, nil
	})

	client := kubernetesfake.NewClientset()
	resourceLists := []*metav1.APIResourceList{
		{
			GroupVersion: "apps/v1",
			APIResources: []metav1.APIResource{
				{Name: "deployments", Namespaced: true, Kind: "Deployment", Verbs: []string{"list"}},
				{Name: "statefulsets", Namespaced: true, Kind: "StatefulSet", Verbs: []string{"list"}},
			},
		},
	}
	baseDiscovery := client.Discovery().(*fakediscovery.FakeDiscovery)
	overrideDiscovery := &preferredDiscovery{FakeDiscovery: baseDiscovery, resources: resourceLists}
	clientWithDiscovery := &discoveryOverrideClient{Clientset: client, discovery: overrideDiscovery}

	rec := &recordingTelemetry{}
	current := time.Date(2023, 3, 4, 12, 0, 0, 0, time.UTC)
	svc := NewService(Dependencies{
		Common: common.Dependencies{
			KubernetesClient: clientWithDiscovery,
			DynamicClient:    dyn,
		},
		Telemetry: rec,
		Now: func() time.Time {
			return current
		},
	}, &Options{PageSize: 100, ListWorkers: 2, EvictionTTL: time.Hour})

	if err := svc.sync(ctx); err != nil {
		t.Fatalf("initial sync failed: %v", err)
	}
	if svc.Count() != 2 {
		t.Fatalf("expected catalog to contain both resources, got %d", svc.Count())
	}
	if health := svc.Health(); health.Status != HealthStateOK {
		t.Fatalf("expected healthy catalog status, got %s", health.Status)
	}

	entry := rec.last()
	if entry.err != nil {
		t.Fatalf("expected initial telemetry record without error, got %v", entry.err)
	}
	if entry.itemCount != 2 {
		t.Fatalf("expected telemetry item count 2, got %d", entry.itemCount)
	}
	if entry.resourceCount != 2 {
		t.Fatalf("expected telemetry resource count 2, got %d", entry.resourceCount)
	}

	shouldFailStateful = true
	current = current.Add(30 * time.Second)
	err := svc.sync(ctx)
	if err == nil {
		t.Fatalf("expected partial failure error")
	}
	partial := &PartialSyncError{}
	if !errors.As(err, &partial) {
		t.Fatalf("expected PartialSyncError, got %v", err)
	}
	if partial.FailedCount() != 1 {
		t.Fatalf("expected single failed descriptor, got %d (%v)", partial.FailedCount(), partial.FailedDescriptors)
	}
	if svc.Count() != 2 {
		t.Fatalf("expected catalog to retain previous entries, got %d", svc.Count())
	}
	health := svc.Health()
	if health.Status != HealthStateDegraded {
		t.Fatalf("expected degraded health status, got %s", health.Status)
	}
	if !health.Stale {
		t.Fatalf("expected catalog health to be marked stale")
	}
	if health.ConsecutiveFailures != 1 {
		t.Fatalf("expected consecutive failure count 1, got %d", health.ConsecutiveFailures)
	}
	if health.FailedResources != 1 {
		t.Fatalf("expected failed resources count 1, got %d", health.FailedResources)
	}

	entry = rec.last()
	if entry.err == nil {
		t.Fatalf("expected telemetry to record error on partial failure")
	}
	partialEntry := &PartialSyncError{}
	if !errors.As(entry.err, &partialEntry) {
		t.Fatalf("expected telemetry error to be PartialSyncError, got %v", entry.err)
	}
	if partialEntry.FailedCount() != 1 {
		t.Fatalf("expected telemetry error to note single failed descriptor, got %d (%v)", partialEntry.FailedCount(), partialEntry.FailedDescriptors)
	}

	shouldFailStateful = false
	current = current.Add(30 * time.Second)
	if err := svc.sync(ctx); err != nil {
		t.Fatalf("recovery sync failed: %v", err)
	}
	health = svc.Health()
	if health.Status != HealthStateOK {
		t.Fatalf("expected health to recover to ok, got %s", health.Status)
	}
	if health.ConsecutiveFailures != 0 {
		t.Fatalf("expected consecutive failures reset, got %d", health.ConsecutiveFailures)
	}
	if health.Stale {
		t.Fatalf("expected stale flag cleared after success")
	}

	entry = rec.last()
	if entry.err != nil {
		t.Fatalf("expected telemetry to record success after recovery, got %v", entry.err)
	}
	if entry.itemCount != 2 {
		t.Fatalf("expected telemetry item count to remain 2, got %d", entry.itemCount)
	}
}

func TestNextCatalogResyncInterval(t *testing.T) {
	const retry = 3 * time.Second
	const full = 5 * time.Minute
	cases := []struct {
		name    string
		syncOK  bool
		current time.Duration
		retry   time.Duration
		full    time.Duration
		want    time.Duration
	}{
		{"success uses full interval", true, retry, retry, full, full},
		{"success from full stays full", true, full, retry, full, full},
		{"first failure retries short", false, 0, retry, full, retry},
		{"failure backs off by doubling", false, retry, retry, full, 2 * retry},
		{"backoff caps at full", false, 4 * time.Minute, retry, full, full},
		{"retry disabled uses full", false, retry, 0, full, full},
		{"retry >= full uses full", false, retry, full, full, full},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := nextCatalogResyncInterval(tc.syncOK, tc.current, tc.retry, tc.full)
			if got != tc.want {
				t.Fatalf("nextCatalogResyncInterval(%v,%v,%v,%v)=%v want %v",
					tc.syncOK, tc.current, tc.retry, tc.full, got, tc.want)
			}
		})
	}
}

// hookedPreferredDiscovery wraps preferredDiscovery so the test can observe WHEN
// discovery runs relative to the cache wait and the collect.
type hookedPreferredDiscovery struct {
	*preferredDiscovery
	onDiscover func()
}

func (h *hookedPreferredDiscovery) ServerPreferredResources() ([]*metav1.APIResourceList, error) {
	h.onDiscover()
	return h.preferredDiscovery.ServerPreferredResources()
}

// failingDiscovery makes every sync fail at the discovery step, so retry-scheduling
// tests can count sync attempts through telemetry.
type failingDiscovery struct {
	*fakediscovery.FakeDiscovery
}

func (f *failingDiscovery) ServerPreferredResources() ([]*metav1.APIResourceList, error) {
	return nil, errors.New("discovery unavailable")
}

// blockingIngestSource parks AddCatalogSink until released, standing in for a
// sink-registration replay over large ingest stores.
type blockingIngestSource struct {
	release chan struct{}
}

func (b *blockingIngestSource) CatalogRows(schema.GroupVersionResource) []interface{} { return nil }
func (b *blockingIngestSource) AddCatalogSink(schema.GroupVersionResource, ingest.Sink) bool {
	<-b.release
	return false
}
func (b *blockingIngestSource) RegisterDynamicCatalogReflector(schema.GroupVersionResource, schema.GroupVersionKind, ingest.CatalogProjector, bool) bool {
	return false
}
func (b *blockingIngestSource) StopReflectorFor(schema.GroupVersionResource)  {}
func (b *blockingIngestSource) HasSyncedFor(schema.GroupVersionResource) bool { return false }

func (r *recordingTelemetry) count() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.entries)
}

// TestSyncWaitsForCachesBetweenPreflightAndCollect pins the catalog startup overlap:
// discovery and the RBAC preflight are pure API calls and must run BEFORE the
// informer-cache wait (so they overlap the factory's ~10s initial sync); only the
// collect — which reads listers — runs after the wait. A wait failure must abort the
// sync: collecting from unsynced listers would publish an incomplete catalog as
// authoritative.
func TestSyncWaitsForCachesBetweenPreflightAndCollect(t *testing.T) {
	newFixture := func(waitForCaches func(context.Context) error, order *[]string, mu *sync.Mutex) *Service {
		record := func(step string) {
			mu.Lock()
			*order = append(*order, step)
			mu.Unlock()
		}

		scheme := runtime.NewScheme()
		deployGVK := schema.GroupVersionKind{Group: "apps", Version: "v1", Kind: "Deployment"}
		scheme.AddKnownTypeWithName(deployGVK, &unstructured.Unstructured{})
		scheme.AddKnownTypeWithName(deployGVK.GroupVersion().WithKind("DeploymentList"), &unstructured.UnstructuredList{})
		dyn := dynamicfake.NewSimpleDynamicClientWithCustomListKinds(scheme, map[schema.GroupVersionResource]string{
			{Group: "apps", Version: "v1", Resource: "deployments"}: "DeploymentList",
		})
		dyn.PrependReactor("list", "deployments", func(k8stesting.Action) (bool, runtime.Object, error) {
			record("collect")
			return false, nil, nil
		})

		client := kubernetesfake.NewClientset()
		baseDiscovery := client.Discovery().(*fakediscovery.FakeDiscovery)
		hooked := &hookedPreferredDiscovery{
			preferredDiscovery: &preferredDiscovery{FakeDiscovery: baseDiscovery, resources: []*metav1.APIResourceList{{
				GroupVersion: "apps/v1",
				APIResources: []metav1.APIResource{{Name: "deployments", Namespaced: true, Kind: "Deployment", Verbs: []string{"list"}}},
			}}},
			onDiscover: func() { record("discover") },
		}

		return NewService(Dependencies{
			Common: common.Dependencies{
				KubernetesClient: &discoveryOverrideClient{Clientset: client, discovery: hooked},
				DynamicClient:    dyn,
			},
			WaitForCaches: waitForCaches,
		}, nil)
	}

	t.Run("wait sits between discovery and collect", func(t *testing.T) {
		var mu sync.Mutex
		var order []string
		svc := newFixture(func(context.Context) error {
			mu.Lock()
			order = append(order, "wait")
			mu.Unlock()
			return nil
		}, &order, &mu)

		if err := svc.sync(context.Background()); err != nil {
			t.Fatalf("sync failed: %v", err)
		}

		mu.Lock()
		defer mu.Unlock()
		index := func(step string) int {
			for i, s := range order {
				if s == step {
					return i
				}
			}
			return -1
		}
		waits := 0
		for _, s := range order {
			if s == "wait" {
				waits++
			}
		}
		if waits != 1 {
			t.Fatalf("expected exactly one cache wait per sync, got %d (order %v)", waits, order)
		}
		if !(index("discover") >= 0 && index("discover") < index("wait")) {
			t.Fatalf("discovery must run BEFORE the cache wait (overlap), order %v", order)
		}
		if !(index("collect") >= 0 && index("wait") < index("collect")) {
			t.Fatalf("the collect must run AFTER the cache wait, order %v", order)
		}
	})

	t.Run("wait failure aborts the sync before any collect", func(t *testing.T) {
		var mu sync.Mutex
		var order []string
		waitErr := errors.New("caches unavailable")
		svc := newFixture(func(context.Context) error { return waitErr }, &order, &mu)

		err := svc.sync(context.Background())
		if err == nil || !errors.Is(err, waitErr) {
			t.Fatalf("expected sync to fail with the cache-wait error, got %v", err)
		}
		mu.Lock()
		defer mu.Unlock()
		for _, s := range order {
			if s == "collect" {
				t.Fatalf("no collect may run when the cache wait failed, order %v", order)
			}
		}
	})
}

// TestFailedInitialSyncRetriesWhileReactiveRegistrationBlocks pins that the
// failed-sync fast retry is not hostage to reactive-updates registration: the
// sink-registration replay walks populated ingest stores and can take a while, and a
// failed initial sync — the startup race — is exactly when a prompt retry matters.
// runLoop must reach its retry ticker regardless of how long registration takes.
func TestFailedInitialSyncRetriesWhileReactiveRegistrationBlocks(t *testing.T) {
	client := kubernetesfake.NewClientset()
	baseDiscovery := client.Discovery().(*fakediscovery.FakeDiscovery)
	failing := &failingDiscovery{FakeDiscovery: baseDiscovery}
	dyn := dynamicfake.NewSimpleDynamicClient(runtime.NewScheme())

	release := make(chan struct{})
	defer close(release)
	rec := &recordingTelemetry{}

	svc := NewService(Dependencies{
		Common: common.Dependencies{
			KubernetesClient: &discoveryOverrideClient{Clientset: client, discovery: failing},
			DynamicClient:    dyn,
		},
		Telemetry:       rec,
		InformerFactory: informers.NewSharedInformerFactory(client, 0),
		IngestSource:    &blockingIngestSource{release: release},
	}, &Options{
		EnableReactiveUpdates:   true,
		ResyncInterval:          time.Hour,
		FailedSyncRetryInterval: 25 * time.Millisecond,
	})

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() { _ = svc.Run(ctx) }()

	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if rec.count() >= 2 {
			return // a retry sync ran while AddCatalogSink was still parked
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("no failed-sync retry fired while reactive registration was blocked (sync attempts: %d)", rec.count())
}

// The user-observed failure (docs/plans/namespace-scope.md): a RoleBindings-only
// identity gets "catalog RBAC preflight: allowed=0 denied=57" because every
// preflight check is cluster-scoped, so collection is skipped for every kind
// and Browse stays empty even though the identity can list in its namespaces.
// Namespaced kinds must be evaluated per configured scope namespace (any-of);
// cluster-scoped kinds keep the cluster-wide ask.
func TestCatalogPreflightEvaluatesNamespacedKindsPerScopeNamespace(t *testing.T) {
	client := kubernetesfake.NewClientset()
	client.PrependReactor("create", "selfsubjectaccessreviews", func(action k8stesting.Action) (bool, runtime.Object, error) {
		review := action.(k8stesting.CreateAction).GetObject().(*authorizationv1.SelfSubjectAccessReview)
		result := review.DeepCopy()
		// Allowed ONLY inside namespace "prod" — cluster-wide asks denied.
		result.Status.Allowed = review.Spec.ResourceAttributes.Namespace == "prod"
		return true, result, nil
	})

	factory := func() *capabilities.Service {
		return capabilities.NewService(capabilities.Dependencies{
			Common: common.Dependencies{
				KubernetesClient: client,
				EnsureClient:     func(string) error { return nil },
			},
		})
	}

	svc := NewService(Dependencies{
		Common: common.Dependencies{
			KubernetesClient: client,
			EnsureClient:     func(string) error { return nil },
		},
		CapabilityFactory: factory,
		AllowedNamespaces: []string{"prod", "dev"},
	}, nil)
	capSvc := factory()

	deployDesc := resourceDescriptor{
		Resource: "deployments", Group: "apps", Version: "v1", Namespaced: true,
		GVR: schema.GroupVersionResource{Group: "apps", Version: "v1", Resource: "deployments"},
	}
	nodesDesc := resourceDescriptor{
		Resource: "nodes", Version: "v1", Namespaced: false,
		GVR: schema.GroupVersionResource{Version: "v1", Resource: "nodes"},
	}

	batchAllowed, batchErrors, err := svc.evaluateDescriptorsBatch(context.Background(), capSvc, []resourceDescriptor{deployDesc, nodesDesc})
	if err != nil || len(batchErrors) != 0 {
		t.Fatalf("batch evaluation failed: err=%v batchErrors=%+v", err, batchErrors)
	}
	if !batchAllowed[0] {
		t.Fatal("namespaced kind allowed in one scope namespace must pass the preflight")
	}
	if batchAllowed[1] {
		t.Fatal("cluster-scoped kind keeps the cluster-wide ask and stays denied")
	}

	single, err := svc.evaluateDescriptor(context.Background(), capSvc, deployDesc)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !single {
		t.Fatal("single-descriptor preflight must also fan out over the scope")
	}
}
