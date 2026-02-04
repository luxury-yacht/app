/*
 * backend/objectcatalog/query_test.go
 *
 * Catalog query and streaming-driven query tests.
 */

package objectcatalog

import (
	"reflect"
	"testing"

	"github.com/luxury-yacht/app/backend/resources/common"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

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

	kindSet := map[string]bool{"Pod": true} // true = namespaced
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
	expectedKinds := []KindInfo{{Kind: "Deployment", Namespaced: true}, {Kind: "Pod", Namespaced: true}}
	if !reflect.DeepEqual(result.Kinds, expectedKinds) {
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
	expectedClusterKinds := []KindInfo{{Kind: "CustomResourceDefinition", Namespaced: false}}
	if !reflect.DeepEqual(clusterOnly.Kinds, expectedClusterKinds) {
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
	expectedNSKinds := []KindInfo{{Kind: "Service", Namespaced: true}}
	if !reflect.DeepEqual(defaultNS.Kinds, expectedNSKinds) {
		t.Fatalf("unexpected kinds for namespace query: %+v", defaultNS.Kinds)
	}
	if !reflect.DeepEqual(defaultNS.Namespaces, []string{"default"}) {
		t.Fatalf("unexpected namespaces for namespace query: %+v", defaultNS.Namespaces)
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
	expectedSearchKinds := []KindInfo{{Kind: "Pod", Namespaced: true}}
	if !reflect.DeepEqual(result.Kinds, expectedSearchKinds) {
		t.Fatalf("unexpected kinds for search: %+v", result.Kinds)
	}
	if !reflect.DeepEqual(result.Namespaces, []string{"default"}) {
		t.Fatalf("unexpected namespaces for search: %+v", result.Namespaces)
	}
}
