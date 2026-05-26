package objectcatalog

import (
	"context"
	"errors"
	"testing"

	"github.com/luxury-yacht/app/backend/resources/common"
	apiextensionsv1 "k8s.io/apiextensions-apiserver/pkg/apis/apiextensions/v1"
	apiextensionsfake "k8s.io/apiextensions-apiserver/pkg/client/clientset/clientset/fake"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
	fakediscovery "k8s.io/client-go/discovery/fake"
	"k8s.io/client-go/kubernetes/fake"
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

func TestResolveResourceForGVKUsesCatalogDescriptors(t *testing.T) {
	svc := NewService(Dependencies{}, nil)
	desc := resourceDescriptor{
		GVR:        schema.GroupVersionResource{Group: "example.com", Version: "v1alpha1", Resource: "widgets"},
		Namespaced: true,
		Kind:       "Widget",
		Group:      "example.com",
		Version:    "v1alpha1",
		Resource:   "widgets",
		Scope:      ScopeNamespace,
	}
	svc.identity.replaceDiscovered([]resourceDescriptor{desc})

	resolved, ok, err := svc.ResolveResourceForGVK(context.Background(), schema.GroupVersionKind{
		Group:   "example.com",
		Version: "v1alpha1",
		Kind:    "Widget",
	})
	if err != nil {
		t.Fatalf("ResolveResourceForGVK returned error: %v", err)
	}
	if !ok {
		t.Fatal("expected descriptor match")
	}
	if resolved.Resource != "widgets" || !resolved.Namespaced {
		t.Fatalf("unexpected resolved resource: %+v", resolved)
	}

	if _, ok, err := svc.ResolveResourceForGVK(context.Background(), schema.GroupVersionKind{
		Group:   "other.example.com",
		Version: "v1alpha1",
		Kind:    "Widget",
	}); err != nil || ok {
		t.Fatalf("expected no match for wrong group, ok=%v err=%v", ok, err)
	}
}

func TestResolveResourceForGVKUsesBuiltinIdentityBeforeSync(t *testing.T) {
	svc := NewService(Dependencies{}, nil)

	resolved, ok, err := svc.ResolveResourceForGVK(context.Background(), schema.GroupVersionKind{
		Group:   "apps",
		Version: "v1",
		Kind:    "Deployment",
	})
	if err != nil {
		t.Fatalf("ResolveResourceForGVK returned error: %v", err)
	}
	if !ok {
		t.Fatal("expected built-in identity match")
	}
	if resolved.Resource != "deployments" || !resolved.Namespaced {
		t.Fatalf("unexpected resolved resource: %+v", resolved)
	}
}

func TestResourceResolverHydratesFromDiscoveryOnMiss(t *testing.T) {
	client := fake.NewClientset()
	discoveryClient, ok := client.Discovery().(*fakediscovery.FakeDiscovery)
	if !ok {
		t.Fatalf("expected fake discovery client, got %T", client.Discovery())
	}
	discoveryClient.Resources = []*metav1.APIResourceList{{
		GroupVersion: "example.com/v1",
		APIResources: []metav1.APIResource{{
			Name:       "widgets",
			Kind:       "Widget",
			Namespaced: true,
			Verbs:      metav1.Verbs{"list"},
		}},
	}}

	resolver := NewResourceResolver(common.Dependencies{KubernetesClient: client}, nil)
	resolved, ok, err := resolver.ResolveResourceForGVK(context.Background(), schema.GroupVersionKind{
		Group:   "example.com",
		Version: "v1",
		Kind:    "Widget",
	})
	if err != nil {
		t.Fatalf("ResolveResourceForGVK returned error: %v", err)
	}
	if !ok {
		t.Fatal("expected discovery-hydrated identity match")
	}
	if resolved.Resource != "widgets" || !resolved.Namespaced {
		t.Fatalf("unexpected resolved resource: %+v", resolved)
	}
}

type failingPreferredDiscovery struct {
	*fakediscovery.FakeDiscovery
	err error
}

func (f *failingPreferredDiscovery) ServerPreferredResources() ([]*metav1.APIResourceList, error) {
	return nil, f.err
}

func TestResourceResolverFallsBackToCRDWhenDiscoveryFails(t *testing.T) {
	baseClient := fake.NewClientset()
	discoveryClient, ok := baseClient.Discovery().(*fakediscovery.FakeDiscovery)
	if !ok {
		t.Fatalf("expected fake discovery client, got %T", baseClient.Discovery())
	}
	client := &discoveryOverrideClient{
		Clientset: baseClient,
		discovery: &failingPreferredDiscovery{
			FakeDiscovery: discoveryClient,
			err:           errors.New("preferred discovery unavailable"),
		},
	}
	apiExtensionsClient := apiextensionsfake.NewClientset(&apiextensionsv1.CustomResourceDefinition{
		ObjectMeta: metav1.ObjectMeta{Name: "widgets.example.com"},
		Spec: apiextensionsv1.CustomResourceDefinitionSpec{
			Group: "example.com",
			Names: apiextensionsv1.CustomResourceDefinitionNames{
				Plural: "widgets",
				Kind:   "Widget",
			},
			Scope: apiextensionsv1.NamespaceScoped,
			Versions: []apiextensionsv1.CustomResourceDefinitionVersion{{
				Name:    "v1",
				Served:  true,
				Storage: true,
			}},
		},
	})

	resolver := NewResourceResolver(common.Dependencies{
		KubernetesClient:    client,
		APIExtensionsClient: apiExtensionsClient,
	}, nil)
	resolved, ok, err := resolver.ResolveResourceForGVK(context.Background(), schema.GroupVersionKind{
		Group:   "example.com",
		Version: "v1",
		Kind:    "Widget",
	})
	if err != nil {
		t.Fatalf("ResolveResourceForGVK returned error: %v", err)
	}
	if !ok {
		t.Fatal("expected CRD fallback identity match")
	}
	if resolved.Resource != "widgets" || !resolved.Namespaced {
		t.Fatalf("unexpected resolved resource: %+v", resolved)
	}
}
