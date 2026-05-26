package backend

import (
	"context"
	"testing"

	"github.com/luxury-yacht/app/backend/objectcatalog"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

func TestAppResourceResolverReusesColdStartResolver(t *testing.T) {
	app := NewApp()
	clusterID := "config:ctx"
	app.clusterClients = map[string]*clusterClients{
		clusterID: {
			meta:              ClusterMeta{ID: clusterID, Name: "ctx"},
			kubeconfigPath:    "/path",
			kubeconfigContext: "ctx",
		},
	}

	resolver := appResourceResolver{app: app, clusterID: clusterID}
	gvk := schema.GroupVersionKind{Group: "apps", Version: "v1", Kind: "Deployment"}

	firstResolved, ok, err := resolver.ResolveResourceForGVK(context.Background(), gvk)
	if err != nil {
		t.Fatalf("first ResolveResourceForGVK returned error: %v", err)
	}
	if !ok || firstResolved.Resource != "deployments" {
		t.Fatalf("unexpected first resolution: ok=%v resolved=%+v", ok, firstResolved)
	}

	app.clusterClientsMu.Lock()
	firstFallback := app.clusterClients[clusterID].fallbackResourceResolver
	app.clusterClientsMu.Unlock()
	if firstFallback == nil {
		t.Fatal("expected cold-start fallback resolver to be cached")
	}

	secondResolved, ok, err := resolver.ResolveResourceForGVK(context.Background(), gvk)
	if err != nil {
		t.Fatalf("second ResolveResourceForGVK returned error: %v", err)
	}
	if !ok || secondResolved.Resource != "deployments" {
		t.Fatalf("unexpected second resolution: ok=%v resolved=%+v", ok, secondResolved)
	}

	app.clusterClientsMu.Lock()
	secondFallback := app.clusterClients[clusterID].fallbackResourceResolver
	app.clusterClientsMu.Unlock()
	if firstFallback != secondFallback {
		t.Fatal("expected cold-start fallback resolver to be reused")
	}
}

func TestAppResourceResolverUsesCatalogServiceWhenAvailable(t *testing.T) {
	app := NewApp()
	clusterID := "config:ctx"
	app.storeObjectCatalogEntry(clusterID, &objectCatalogEntry{
		service: objectcatalog.NewService(objectcatalog.Dependencies{}, nil),
		meta:    ClusterMeta{ID: clusterID, Name: "ctx"},
	})

	resolver := appResourceResolver{app: app, clusterID: clusterID}
	resolved, ok, err := resolver.ResolveResourceForGVK(context.Background(), schema.GroupVersionKind{
		Group:   "apps",
		Version: "v1",
		Kind:    "Deployment",
	})
	if err != nil {
		t.Fatalf("ResolveResourceForGVK returned error: %v", err)
	}
	if !ok {
		t.Fatal("expected catalog service resolution to succeed")
	}
	if resolved.Resource != "deployments" || !resolved.Namespaced {
		t.Fatalf("unexpected resolved resource: %+v", resolved)
	}
}
