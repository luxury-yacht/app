package objectcatalog

import (
	"testing"

	"k8s.io/apimachinery/pkg/runtime/schema"
)

func TestFindExactMatchReturnsCanonicalItem(t *testing.T) {
	svc := NewService(Dependencies{}, nil)

	namespacedDesc := resourceDescriptor{
		GVR:        schema.GroupVersionResource{Group: "apps", Version: "v1", Resource: "deployments"},
		Namespaced: true,
		Kind:       "Deployment",
		Group:      "apps",
		Version:    "v1",
		Resource:   "deployments",
		Scope:      ScopeNamespace,
	}
	clusterDesc := resourceDescriptor{
		GVR:        schema.GroupVersionResource{Group: "apiextensions.k8s.io", Version: "v1", Resource: "customresourcedefinitions"},
		Namespaced: false,
		Kind:       "CustomResourceDefinition",
		Group:      "apiextensions.k8s.io",
		Version:    "v1",
		Resource:   "customresourcedefinitions",
		Scope:      ScopeCluster,
	}

	svc.mu.Lock()
	svc.items = map[string]Summary{
		catalogKey(namespacedDesc, "apps", "demo"): {
			ClusterID: "cluster-a",
			Kind:      "Deployment",
			Group:     "apps",
			Version:   "v1",
			Resource:  "deployments",
			Namespace: "apps",
			Name:      "demo",
			UID:       "deploy-uid",
			Scope:     ScopeNamespace,
		},
		catalogKey(clusterDesc, "", "widgets.example.com"): {
			ClusterID: "cluster-a",
			Kind:      "CustomResourceDefinition",
			Group:     "apiextensions.k8s.io",
			Version:   "v1",
			Resource:  "customresourcedefinitions",
			Name:      "widgets.example.com",
			UID:       "crd-uid",
			Scope:     ScopeCluster,
		},
	}
	svc.mu.Unlock()

	match, ok := svc.FindExactMatch("apps", "apps", "v1", "Deployment", "demo")
	if !ok {
		t.Fatal("expected namespaced item match")
	}
	if match.UID != "deploy-uid" {
		t.Fatalf("expected deployment uid, got %q", match.UID)
	}

	clusterMatch, ok := svc.FindExactMatch("__cluster__", "apiextensions.k8s.io", "v1", "CustomResourceDefinition", "widgets.example.com")
	if !ok {
		t.Fatal("expected cluster-scoped item match")
	}
	if clusterMatch.UID != "crd-uid" {
		t.Fatalf("expected crd uid, got %q", clusterMatch.UID)
	}
}

func TestFindExactMatchRejectsPartialMatches(t *testing.T) {
	svc := NewService(Dependencies{}, nil)

	desc := resourceDescriptor{
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
		catalogKey(desc, "apps", "alpha"): {
			Kind:      "Deployment",
			Group:     "apps",
			Version:   "v1",
			Resource:  "deployments",
			Namespace: "apps",
			Name:      "alpha",
			UID:       "alpha-uid",
			Scope:     ScopeNamespace,
		},
	}
	svc.mu.Unlock()

	if _, ok := svc.FindExactMatch("apps", "apps", "v1", "Deployment", "alp"); ok {
		t.Fatal("unexpected exact match for partial name")
	}
	if _, ok := svc.FindExactMatch("apps", "apps", "v1", "StatefulSet", "alpha"); ok {
		t.Fatal("unexpected exact match for different kind")
	}
	if _, ok := svc.FindExactMatch("apps", "apps", "", "Deployment", "alpha"); ok {
		t.Fatal("unexpected exact match when version is missing")
	}
}
