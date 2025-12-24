package objectcatalog

import (
	"context"
	"errors"
	"reflect"
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

func TestServiceQueryStreamsWithoutFullCache(t *testing.T) {
	svc := NewService(Dependencies{}, nil)

	chunk := &summaryChunk{
		items: []Summary{
			{
				Kind:      "Pod",
				Group:     "",
				Version:   "v1",
				Resource:  "pods",
				Namespace: "default",
				Name:      "demo-pod",
				UID:       "uid-1",
				Scope:     ScopeNamespace,
			},
			{
				Kind:      "Pod",
				Group:     "",
				Version:   "v1",
				Resource:  "pods",
				Namespace: "kube-system",
				Name:      "controller",
				UID:       "uid-2",
				Scope:     ScopeNamespace,
			},
		},
	}

	kindSet := map[string]struct{}{"Pod": {}}
	namespaceSet := map[string]struct{}{"default": {}, "kube-system": {}}
	descriptors := []Descriptor{
		{Group: "", Version: "v1", Resource: "pods", Kind: "Pod", Scope: ScopeNamespace, Namespaced: true},
	}

	svc.publishStreamingState([]*summaryChunk{chunk}, kindSet, namespaceSet, descriptors, false)

	result := svc.Query(QueryOptions{Limit: 1})
	if len(result.Items) != 1 {
		t.Fatalf("expected first page with 1 item, got %d", len(result.Items))
	}
	if result.Items[0].Name != "demo-pod" {
		t.Fatalf("expected first item demo-pod, got %s", result.Items[0].Name)
	}
	if result.TotalItems != 2 {
		t.Fatalf("expected total matches 2, got %d", result.TotalItems)
	}
	if result.ContinueToken != "1" {
		t.Fatalf("expected continue token 1, got %q", result.ContinueToken)
	}

	next := svc.Query(QueryOptions{Limit: 1, Continue: result.ContinueToken})
	if len(next.Items) != 1 || next.Items[0].Name != "controller" {
		t.Fatalf("expected second page to contain controller, got %+v", next.Items)
	}
	if next.ContinueToken != "" {
		t.Fatalf("expected no further pages, got %q", next.ContinueToken)
	}
}

func TestServiceSyncCollectsResources(t *testing.T) {
	scheme := runtime.NewScheme()
	appsGVK := schema.GroupVersionKind{Group: "apps", Version: "v1", Kind: "Deployment"}
	scheme.AddKnownTypeWithName(appsGVK, &unstructured.Unstructured{})
	scheme.AddKnownTypeWithName(appsGVK.GroupVersion().WithKind("DeploymentList"), &unstructured.UnstructuredList{})

	obj := &unstructured.Unstructured{}
	obj.SetGroupVersionKind(appsGVK)
	obj.SetNamespace("default")
	obj.SetName("demo")
	obj.SetCreationTimestamp(metav1.NewTime(time.Date(2023, 3, 4, 12, 0, 0, 0, time.UTC)))
	obj.SetLabels(map[string]string{"app": "demo", "tier": "backend"})

	obj.SetResourceVersion("1")

	listKinds := map[schema.GroupVersionResource]string{
		{Group: "apps", Version: "v1", Resource: "deployments"}: "DeploymentList",
	}
	dyn := dynamicfake.NewSimpleDynamicClientWithCustomListKinds(scheme, listKinds)
	gvr := schema.GroupVersionResource{Group: "apps", Version: "v1", Resource: "deployments"}
	if _, err := dyn.Resource(gvr).Namespace("default").Create(context.Background(), obj.DeepCopy(), metav1.CreateOptions{}); err != nil {
		t.Fatalf("failed to seed dynamic client: %v", err)
	}

	checkList, err := dyn.Resource(gvr).Namespace(metav1.NamespaceAll).List(context.Background(), metav1.ListOptions{})
	if err != nil {
		t.Fatalf("failed to list seeded resources: %v", err)
	}
	if len(checkList.Items) != 1 {
		t.Fatalf("expected seeded resource visible, got %d", len(checkList.Items))
	}

	now := func() time.Time { return time.Date(2023, 3, 4, 12, 5, 0, 0, time.UTC) }

	deps := Dependencies{
		Common: common.Dependencies{
			Context:       context.Background(),
			DynamicClient: dyn,
		},
		Now: now,
	}

	svc := NewService(deps, &Options{ResyncInterval: time.Minute, PageSize: 200, ListWorkers: 2})
	desc := resourceDescriptor{
		GVR:        gvr,
		Namespaced: true,
		Kind:       "Deployment",
		Group:      "apps",
		Version:    "v1",
		Resource:   "deployments",
		Scope:      ScopeNamespace,
	}
	summaries, err := svc.collectResource(context.Background(), 0, desc, nil, nil)
	if err != nil {
		t.Fatalf("collectResource failed: %v", err)
	}
	if len(summaries) != 1 {
		t.Fatalf("unexpected catalog size: got %d, want 1", len(summaries))
	}

	summary := summaries[0]
	if summary.Kind != "Deployment" {
		t.Errorf("unexpected kind: %s", summary.Kind)
	}
	if summary.Namespace != "default" {
		t.Errorf("unexpected namespace: %s", summary.Namespace)
	}
	if summary.Name != "demo" {
		t.Errorf("unexpected name: %s", summary.Name)
	}
	if summary.Scope != ScopeNamespace {
		t.Errorf("unexpected scope: %s", summary.Scope)
	}
	if summary.LabelsDigest == "" {
		t.Errorf("expected labels digest to be set")
	}
}

func TestLabelsDigestDeterministic(t *testing.T) {
	a := labelsDigest(map[string]string{
		"b": "2",
		"a": "1",
	})
	b := labelsDigest(map[string]string{
		"a": "1",
		"b": "2",
	})
	if a == "" || b == "" {
		t.Fatalf("expected non-empty digest")
	}
	if a != b {
		t.Fatalf("expected digests to match, got %s and %s", a, b)
	}
}

func TestLabelsDigestEmpty(t *testing.T) {
	if digest := labelsDigest(nil); digest != "" {
		t.Fatalf("expected empty digest, got %q", digest)
	}
}

func TestCatalogKeyFormats(t *testing.T) {
	nsGVR := schema.GroupVersionResource{Group: "apps", Version: "v1", Resource: "deployments"}
	descNamespace := resourceDescriptor{GVR: nsGVR, Namespaced: true}
	expectedNamespaced := nsGVR.String() + "/default/demo"
	if key := catalogKey(descNamespace, "default", "demo"); key != expectedNamespaced {
		t.Fatalf("unexpected namespaced key: %s", key)
	}

	clusterGVR := schema.GroupVersionResource{Group: "apiextensions.k8s.io", Version: "v1", Resource: "customresourcedefinitions"}
	descCluster := resourceDescriptor{GVR: clusterGVR, Namespaced: false}
	expectedCluster := clusterGVR.String() + "//widgets.example.com"
	if key := catalogKey(descCluster, "", "widgets.example.com"); key != expectedCluster {
		t.Fatalf("unexpected cluster key: %s", key)
	}
}

func TestContainsVerb(t *testing.T) {
	if !containsVerb([]string{"get", "list"}, "list") {
		t.Fatalf("expected list to be detected")
	}
	if containsVerb([]string{"get"}, "LIST") {
		t.Fatalf("expected missing verb to return false")
	}
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

func TestCollectResourceWithoutDynamicClient(t *testing.T) {
	svc := NewService(Dependencies{Common: common.Dependencies{}}, nil)
	desc := resourceDescriptor{}
	if _, err := svc.collectResource(context.Background(), 0, desc, nil, nil); err == nil {
		t.Fatalf("expected error when dynamic client missing")
	}
}

func TestCollectResourceHandlesPagination(t *testing.T) {
	scheme := runtime.NewScheme()
	appsGVK := schema.GroupVersionKind{Group: "apps", Version: "v1", Kind: "Deployment"}
	scheme.AddKnownTypeWithName(appsGVK, &unstructured.Unstructured{})
	scheme.AddKnownTypeWithName(appsGVK.GroupVersion().WithKind("DeploymentList"), &unstructured.UnstructuredList{})

	dyn := dynamicfake.NewSimpleDynamicClientWithCustomListKinds(scheme, map[schema.GroupVersionResource]string{
		{Group: "apps", Version: "v1", Resource: "deployments"}: "DeploymentList",
	})

	gvr := schema.GroupVersionResource{Group: "apps", Version: "v1", Resource: "deployments"}
	page := 0
	dyn.PrependReactor("list", "deployments", func(action k8stesting.Action) (handled bool, ret runtime.Object, err error) {
		page++
		token := ""
		items := []unstructured.Unstructured{}
		if page == 1 {
			obj := &unstructured.Unstructured{}
			obj.SetGroupVersionKind(appsGVK)
			obj.SetNamespace("default")
			obj.SetName("demo")
			obj.SetResourceVersion("1")
			items = append(items, *obj)
			token = "next"
		}
		list := &unstructured.UnstructuredList{}
		list.SetGroupVersionKind(appsGVK.GroupVersion().WithKind("DeploymentList"))
		list.Items = append(list.Items, items...)
		list.SetContinue(token)
		return true, list, nil
	})

	svc := NewService(Dependencies{Common: common.Dependencies{DynamicClient: dyn}}, &Options{PageSize: 1})
	desc := resourceDescriptor{GVR: gvr, Namespaced: true, Scope: ScopeNamespace}
	summaries, err := svc.collectResource(context.Background(), 0, desc, nil, nil)
	if err != nil {
		t.Fatalf("collectResource failed: %v", err)
	}
	if len(summaries) != 1 {
		t.Fatalf("expected single item after pagination, got %d", len(summaries))
	}
	if summaries[0].Name != "demo" {
		t.Fatalf("expected summary to contain paginated object, got %s", summaries[0].Name)
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

func TestListResourceParallelNamespaces(t *testing.T) {
	scheme := runtime.NewScheme()
	cfgGVK := schema.GroupVersionKind{Group: "apps", Version: "v1", Kind: "Deployment"}
	scheme.AddKnownTypeWithName(cfgGVK, &unstructured.Unstructured{})
	scheme.AddKnownTypeWithName(cfgGVK.GroupVersion().WithKind("DeploymentList"), &unstructured.UnstructuredList{})

	listKinds := map[schema.GroupVersionResource]string{
		{Group: "apps", Version: "v1", Resource: "deployments"}: "DeploymentList",
	}

	objA := &unstructured.Unstructured{}
	objA.SetGroupVersionKind(cfgGVK)
	objA.SetNamespace("alpha")
	objA.SetName("sample-a")

	objB := &unstructured.Unstructured{}
	objB.SetGroupVersionKind(cfgGVK)
	objB.SetNamespace("beta")
	objB.SetName("sample-b")

	dyn := dynamicfake.NewSimpleDynamicClientWithCustomListKinds(scheme, listKinds, objA, objB)

	client := kubernetesfake.NewClientset()
	discovery := client.Discovery().(*fakediscovery.FakeDiscovery)
	discovery.Resources = []*metav1.APIResourceList{
		{
			GroupVersion: "apps/v1",
			APIResources: []metav1.APIResource{
				{Name: "deployments", Namespaced: true, Kind: "Deployment", Verbs: []string{"list"}},
			},
		},
	}

	svc := NewService(Dependencies{Common: common.Dependencies{KubernetesClient: client, DynamicClient: dyn}}, &Options{NamespaceWorkers: 4, PageSize: 10})

	desc := resourceDescriptor{
		GVR:        schema.GroupVersionResource{Group: "apps", Version: "v1", Resource: "deployments"},
		Namespaced: true,
		Kind:       "Deployment",
		Group:      "apps",
		Version:    "v1",
		Resource:   "deployments",
		Scope:      ScopeNamespace,
	}

	items, err := svc.listResource(context.Background(), 0, desc, []string{"alpha", "beta"}, nil)
	if err != nil {
		t.Fatalf("listResource returned error: %v", err)
	}
	if len(items) != 2 {
		t.Fatalf("expected results from both namespaces, got %d", len(items))
	}
	names := map[string]struct{}{}
	for _, item := range items {
		names[item.Name] = struct{}{}
	}
	if _, ok := names["sample-a"]; !ok {
		t.Fatalf("expected sample-a in results")
	}
	if _, ok := names["sample-b"]; !ok {
		t.Fatalf("expected sample-b in results")
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

func TestServiceStreamingSubscriptionReceivesUpdates(t *testing.T) {
	svc := NewService(Dependencies{}, nil)

	updates, unsubscribe := svc.SubscribeStreaming()
	defer unsubscribe()

	select {
	case update := <-updates:
		if update.Ready {
			t.Fatalf("expected initial update to not be ready")
		}
	case <-time.After(100 * time.Millisecond):
		t.Fatalf("timed out waiting for initial streaming update")
	}

	agg := newStreamingAggregator(svc)
	agg.emit(0, []Summary{{Kind: "Pod", Name: "p1"}})

	select {
	case update := <-updates:
		if update.Ready {
			t.Fatalf("expected non-final flush to report not ready")
		}
	case <-time.After(100 * time.Millisecond):
		t.Fatalf("timed out waiting for flush update")
	}

	agg.finalize(nil, true)

	select {
	case update := <-updates:
		if !update.Ready {
			t.Fatalf("expected final update to report ready")
		}
	case <-time.After(100 * time.Millisecond):
		t.Fatalf("timed out waiting for final update")
	}
}

func TestBuildSummaryNamespaced(t *testing.T) {
	desc := resourceDescriptor{Kind: "Pod", Group: "", Version: "v1", Resource: "pods", Scope: ScopeNamespace}
	obj := &unstructured.Unstructured{}
	obj.SetNamespace("default")
	obj.SetName("example")
	obj.SetLabels(map[string]string{"app": "demo"})

	svc := NewService(Dependencies{Common: common.Dependencies{}}, nil)
	summary := svc.buildSummary(desc, obj)
	if summary.Namespace != "default" {
		t.Fatalf("expected namespace to be preserved")
	}
	if summary.LabelsDigest == "" {
		t.Fatalf("expected labels digest to be populated")
	}
}

func TestExtractDescriptorsSkipsUnsupported(t *testing.T) {
	resourceLists := []*metav1.APIResourceList{
		{
			GroupVersion: "apps/v1",
			APIResources: []metav1.APIResource{
				{
					Name:       "widgets",
					Namespaced: true,
					Kind:       "Widget",
					Verbs:      []string{"get"},
				},
				{
					Name:       "gizmos",
					Namespaced: true,
					Kind:       "Gizmo",
					Verbs:      []string{"get", "list"},
				},
				{
					Name:       "deployments",
					Namespaced: true,
					Kind:       "Deployment",
					Verbs:      []string{"get", "list"},
				},
				{
					Name:       "deployments/status",
					Namespaced: true,
					Kind:       "Deployment",
					Verbs:      []string{"get"},
				},
			},
		},
		{
			GroupVersion: "v1",
			APIResources: []metav1.APIResource{
				{
					Name:       "events",
					Namespaced: true,
					Kind:       "Event",
					Verbs:      []string{"get", "list"},
				},
				{
					Name:       "componentstatuses",
					Namespaced: false,
					Kind:       "ComponentStatus",
					Verbs:      []string{"get", "list"},
				},
			},
		},
	}

	svc := NewService(Dependencies{Common: common.Dependencies{}}, nil)
	descriptors := svc.extractDescriptors(resourceLists)
	if len(descriptors) != 2 {
		t.Fatalf("expected 2 descriptors, got %d", len(descriptors))
	}
	resources := map[string]struct{}{}
	for _, desc := range descriptors {
		resources[desc.Resource] = struct{}{}
	}
	if _, ok := resources["deployments"]; !ok {
		t.Fatalf("expected deployments descriptor, got %+v", descriptors)
	}
	if _, ok := resources["gizmos"]; !ok {
		t.Fatalf("expected gizmos descriptor, got %+v", descriptors)
	}
}

func TestStreamingAggregatorEmitsOutOfOrderBatches(t *testing.T) {
	svc := NewService(Dependencies{}, nil)
	agg := newStreamingAggregator(svc)

	summaries := []Summary{
		{
			Kind:      "Namespace",
			Group:     "",
			Version:   "v1",
			Resource:  "namespaces",
			Name:      "default",
			Scope:     ScopeCluster,
			Namespace: "",
		},
	}

	agg.emit(5, summaries)

	result := svc.Query(QueryOptions{Limit: 10})
	if len(result.Items) != 1 {
		t.Fatalf("expected 1 item, got %d", len(result.Items))
	}
	if result.Items[0].Name != "default" || result.Items[0].Kind != "Namespace" {
		t.Fatalf("unexpected item streamed: %+v", result.Items[0])
	}
}

func TestPruneMissingRemovesExpired(t *testing.T) {
	now := time.Date(2024, 2, 1, 12, 0, 0, 0, time.UTC)
	deps := Dependencies{Now: func() time.Time { return now }, Common: common.Dependencies{}}
	svc := NewService(deps, &Options{EvictionTTL: time.Minute})

	seen := map[string]time.Time{
		"recent": now,
		"old":    now.Add(-2 * time.Minute),
	}

	svc.pruneMissing(seen)

	if _, ok := seen["old"]; ok {
		t.Fatalf("expected old entry to be pruned")
	}
	if _, ok := seen["recent"]; !ok {
		t.Fatalf("expected recent entry to remain")
	}
}

func TestPruneMissingDisabledTTL(t *testing.T) {
	base := time.Date(2024, 6, 1, 12, 0, 0, 0, time.UTC)
	svc := NewService(Dependencies{Now: func() time.Time { return base }, Common: common.Dependencies{}}, nil)
	svc.opts.EvictionTTL = 0
	entries := map[string]time.Time{"keep": base.Add(-time.Hour)}
	svc.pruneMissing(entries)
	if len(entries) != 1 {
		t.Fatalf("expected entries unchanged when TTL disabled")
	}
}

func TestBuildSummaryClusterScope(t *testing.T) {
	desc := resourceDescriptor{
		Kind:     "CustomThing",
		Group:    "custom.io",
		Version:  "v1",
		Resource: "customthings",
		Scope:    ScopeCluster,
	}

	obj := &unstructured.Unstructured{}
	obj.SetName("example")
	obj.SetCreationTimestamp(metav1.NewTime(time.Date(2023, 1, 2, 3, 4, 5, 0, time.UTC)))

	svc := NewService(Dependencies{Now: time.Now, Common: common.Dependencies{}}, nil)
	summary := svc.buildSummary(desc, obj)

	if summary.Namespace != "" {
		t.Fatalf("expected cluster-scoped resource to have empty namespace, got %q", summary.Namespace)
	}
	if summary.Scope != ScopeCluster {
		t.Fatalf("expected cluster scope, got %s", summary.Scope)
	}
	if summary.CreationTimestamp != "2023-01-02T03:04:05Z" {
		t.Fatalf("unexpected creation timestamp %s", summary.CreationTimestamp)
	}
}

func TestQueryFiltersAndPagination(t *testing.T) {
	svc := NewService(Dependencies{Common: common.Dependencies{}}, nil)

	podDesc := resourceDescriptor{
		GVR:        schema.GroupVersionResource{Group: "", Version: "v1", Resource: "pods"},
		Namespaced: true,
		Kind:       "Pod",
		Group:      "",
		Version:    "v1",
		Resource:   "pods",
		Scope:      ScopeNamespace,
	}
	deployDesc := resourceDescriptor{
		GVR:        schema.GroupVersionResource{Group: "apps", Version: "v1", Resource: "deployments"},
		Namespaced: true,
		Kind:       "Deployment",
		Group:      "apps",
		Version:    "v1",
		Resource:   "deployments",
		Scope:      ScopeNamespace,
	}

	svc.mu.Lock()
	svc.items = map[string]Summary{
		catalogKey(podDesc, "default", "pod-a"): {
			Kind:      "Pod",
			Group:     "",
			Version:   "v1",
			Resource:  "pods",
			Namespace: "default",
			Name:      "pod-a",
			Scope:     ScopeNamespace,
		},
		catalogKey(podDesc, "kube-system", "pod-b"): {
			Kind:      "Pod",
			Group:     "",
			Version:   "v1",
			Resource:  "pods",
			Namespace: "kube-system",
			Name:      "pod-b",
			Scope:     ScopeNamespace,
		},
		catalogKey(deployDesc, "default", "deploy-a"): {
			Kind:      "Deployment",
			Group:     "apps",
			Version:   "v1",
			Resource:  "deployments",
			Namespace: "default",
			Name:      "deploy-a",
			Scope:     ScopeNamespace,
		},
	}
	svc.resources = map[string]resourceDescriptor{
		podDesc.GVR.String():    podDesc,
		deployDesc.GVR.String(): deployDesc,
	}
	svc.mu.Unlock()

	result := svc.Query(QueryOptions{
		Kinds:  []string{"Pod"},
		Limit:  1,
		Search: "",
	})

	if result.TotalItems != 2 {
		t.Fatalf("expected 2 pods, got %d", result.TotalItems)
	}
	if len(result.Items) != 1 {
		t.Fatalf("expected first page to return 1 item, got %d", len(result.Items))
	}
	if result.ContinueToken != "1" {
		t.Fatalf("expected continue token '1', got %q", result.ContinueToken)
	}
	if result.ResourceCount != 1 {
		t.Fatalf("expected resource count 1 for pod filter, got %d", result.ResourceCount)
	}
	if !reflect.DeepEqual(result.Kinds, []string{"Deployment", "Pod"}) {
		t.Fatalf("unexpected kinds: %+v", result.Kinds)
	}
	if !reflect.DeepEqual(result.Namespaces, []string{"default", "kube-system"}) {
		t.Fatalf("unexpected namespaces: %+v", result.Namespaces)
	}

	next := svc.Query(QueryOptions{
		Kinds:    []string{"Pod"},
		Limit:    1,
		Continue: result.ContinueToken,
	})
	if len(next.Items) != 1 {
		t.Fatalf("expected second page to return 1 item, got %d", len(next.Items))
	}
	if next.ContinueToken != "" {
		t.Fatalf("expected no further pages, got token %q", next.ContinueToken)
	}
}

func TestQueryNamespaceClusterFiltering(t *testing.T) {
	clusterDesc := resourceDescriptor{
		GVR:        schema.GroupVersionResource{Group: "apiextensions.k8s.io", Version: "v1", Resource: "customresourcedefinitions"},
		Namespaced: false,
		Kind:       "CustomResourceDefinition",
		Group:      "apiextensions.k8s.io",
		Version:    "v1",
		Resource:   "customresourcedefinitions",
		Scope:      ScopeCluster,
	}
	namespacedDesc := resourceDescriptor{
		GVR:        schema.GroupVersionResource{Group: "", Version: "v1", Resource: "services"},
		Namespaced: true,
		Kind:       "Service",
		Group:      "",
		Version:    "v1",
		Resource:   "services",
		Scope:      ScopeNamespace,
	}

	svc := NewService(Dependencies{Common: common.Dependencies{}}, nil)
	svc.mu.Lock()
	svc.items = map[string]Summary{
		catalogKey(clusterDesc, "", "crd.one"): {
			Kind:     "CustomResourceDefinition",
			Group:    "apiextensions.k8s.io",
			Version:  "v1",
			Resource: "customresourcedefinitions",
			Name:     "crd.one",
			Scope:    ScopeCluster,
		},
		catalogKey(namespacedDesc, "default", "svc-one"): {
			Kind:      "Service",
			Group:     "",
			Version:   "v1",
			Resource:  "services",
			Namespace: "default",
			Name:      "svc-one",
			Scope:     ScopeNamespace,
		},
	}
	svc.resources = map[string]resourceDescriptor{
		clusterDesc.GVR.String():    clusterDesc,
		namespacedDesc.GVR.String(): namespacedDesc,
	}
	svc.mu.Unlock()

	clusterOnly := svc.Query(QueryOptions{
		Namespaces: []string{"cluster"},
	})
	if clusterOnly.TotalItems != 1 || clusterOnly.Items[0].Scope != ScopeCluster {
		t.Fatalf("expected only cluster-scoped items, got %+v", clusterOnly)
	}
	if !reflect.DeepEqual(clusterOnly.Kinds, []string{"CustomResourceDefinition"}) {
		t.Fatalf("unexpected kinds for cluster query: %+v", clusterOnly.Kinds)
	}
	if !reflect.DeepEqual(clusterOnly.Namespaces, []string{"default"}) {
		t.Fatalf("unexpected namespaces for cluster query: %+v", clusterOnly.Namespaces)
	}

	defaultNS := svc.Query(QueryOptions{
		Namespaces: []string{"default"},
	})
	if defaultNS.TotalItems != 1 || defaultNS.Items[0].Namespace != "default" {
		t.Fatalf("expected only default namespace items, got %+v", defaultNS)
	}
	if !reflect.DeepEqual(defaultNS.Kinds, []string{"Service"}) {
		t.Fatalf("unexpected kinds for namespace query: %+v", defaultNS.Kinds)
	}
	if !reflect.DeepEqual(defaultNS.Namespaces, []string{"default"}) {
		t.Fatalf("unexpected namespaces for namespace query: %+v", defaultNS.Namespaces)
	}
}

func TestDescriptorsSortedCopy(t *testing.T) {
	descA := resourceDescriptor{
		GVR:        schema.GroupVersionResource{Group: "a.example.com", Version: "v1", Resource: "widgets"},
		Namespaced: true,
		Kind:       "Widget",
		Group:      "a.example.com",
		Version:    "v1",
		Resource:   "widgets",
		Scope:      ScopeNamespace,
	}
	descB := resourceDescriptor{
		GVR:        schema.GroupVersionResource{Group: "", Version: "v1", Resource: "pods"},
		Namespaced: true,
		Kind:       "Pod",
		Group:      "",
		Version:    "v1",
		Resource:   "pods",
		Scope:      ScopeNamespace,
	}

	svc := NewService(Dependencies{Common: common.Dependencies{}}, nil)
	svc.mu.Lock()
	svc.resources = map[string]resourceDescriptor{
		descB.GVR.String(): descB,
		descA.GVR.String(): descA,
	}
	svc.mu.Unlock()

	descriptors := svc.Descriptors()
	if len(descriptors) != 2 {
		t.Fatalf("expected 2 descriptors, got %d", len(descriptors))
	}
	if descriptors[0].Group != "" || descriptors[0].Kind != "Pod" {
		t.Fatalf("expected descriptors sorted by group/version/resource, got %+v", descriptors)
	}

	descriptors[0].Kind = "Mutated"
	svc.mu.RLock()
	orig := svc.resources[descB.GVR.String()]
	svc.mu.RUnlock()
	if orig.Kind != "Pod" {
		t.Fatalf("expected original descriptor to remain unchanged")
	}
}

func TestQuerySearchFilter(t *testing.T) {
	svc := NewService(Dependencies{Common: common.Dependencies{}}, nil)
	podDesc := resourceDescriptor{
		GVR:        schema.GroupVersionResource{Group: "", Version: "v1", Resource: "pods"},
		Namespaced: true,
		Kind:       "Pod",
		Group:      "",
		Version:    "v1",
		Resource:   "pods",
		Scope:      ScopeNamespace,
	}

	svc.mu.Lock()
	svc.items = map[string]Summary{
		catalogKey(podDesc, "default", "catalog-api"): {
			Kind:      "Pod",
			Group:     "",
			Version:   "v1",
			Resource:  "pods",
			Namespace: "default",
			Name:      "catalog-api",
			Scope:     ScopeNamespace,
		},
		catalogKey(podDesc, "default", "metrics-writer"): {
			Kind:      "Pod",
			Group:     "",
			Version:   "v1",
			Resource:  "pods",
			Namespace: "default",
			Name:      "metrics-writer",
			Scope:     ScopeNamespace,
		},
	}
	svc.resources = map[string]resourceDescriptor{
		podDesc.GVR.String(): podDesc,
	}
	svc.mu.Unlock()

	result := svc.Query(QueryOptions{Search: "catalog"})
	if result.TotalItems != 1 {
		t.Fatalf("expected search to match 1 item, got %d", result.TotalItems)
	}
	if len(result.Items) != 1 || result.Items[0].Name != "catalog-api" {
		t.Fatalf("unexpected search results: %+v", result.Items)
	}
	if !reflect.DeepEqual(result.Kinds, []string{"Pod"}) {
		t.Fatalf("unexpected kinds for search: %+v", result.Kinds)
	}
	if !reflect.DeepEqual(result.Namespaces, []string{"default"}) {
		t.Fatalf("unexpected namespaces for search: %+v", result.Namespaces)
	}
}
