/*
 * backend/objectcatalog/collect_test.go
 *
 * Catalog collection and summary generation tests.
 */

package objectcatalog

import (
	"context"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/resources/common"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	fakediscovery "k8s.io/client-go/discovery/fake"
	dynamicfake "k8s.io/client-go/dynamic/fake"
	kubernetesfake "k8s.io/client-go/kubernetes/fake"
	k8stesting "k8s.io/client-go/testing"
)

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
