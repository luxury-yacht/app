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
	"github.com/luxury-yacht/app/backend/resources/common"
	authorizationv1 "k8s.io/api/authorization/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/discovery"
	fakediscovery "k8s.io/client-go/discovery/fake"
	dynamicfake "k8s.io/client-go/dynamic/fake"
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
