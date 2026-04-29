package backend

import (
	"context"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/refresh/permissions"
	"github.com/luxury-yacht/app/backend/refresh/system"
	"github.com/luxury-yacht/app/backend/resources/common"
)

func TestCanServeCachedResponseDeniedEvictsCaches(t *testing.T) {
	app := NewApp()
	app.responseCache = newResponseCache(time.Minute, 10)
	selectionKey := "cluster-a"

	checker := permissions.NewCheckerWithReview(selectionKey, time.Minute, func(context.Context, string, string, string) (bool, error) {
		return false, nil
	})
	app.refreshSubsystems[selectionKey] = &system.Subsystem{RuntimePerms: checker}

	// Use Helm kinds to avoid GVR discovery in the permission gate.
	detailKey := objectDetailCacheKey("HelmManifest", "default", "demo")
	app.responseCacheStore(selectionKey, detailKey, "manifest")

	deps := common.Dependencies{Context: context.Background()}
	if allowed := app.canServeCachedResponse(context.Background(), deps, selectionKey, "HelmManifest", "default", "demo"); allowed {
		t.Fatalf("expected permission denial to block cached response")
	}
	if _, ok := app.responseCacheLookup(selectionKey, detailKey); ok {
		t.Fatalf("expected detail cache entry to be evicted on permission deny")
	}
}

func TestCanServeCachedResponseAllowedKeepsCaches(t *testing.T) {
	app := NewApp()
	app.responseCache = newResponseCache(time.Minute, 10)
	selectionKey := "cluster-a"

	checker := permissions.NewCheckerWithReview(selectionKey, time.Minute, func(context.Context, string, string, string) (bool, error) {
		return true, nil
	})
	app.refreshSubsystems[selectionKey] = &system.Subsystem{RuntimePerms: checker}

	// Use Helm kinds to avoid GVR discovery in the permission gate.
	detailKey := objectDetailCacheKey("HelmValues", "default", "demo")
	app.responseCacheStore(selectionKey, detailKey, "values")

	deps := common.Dependencies{Context: context.Background()}
	if allowed := app.canServeCachedResponse(context.Background(), deps, selectionKey, "HelmValues", "default", "demo"); !allowed {
		t.Fatalf("expected permission allow to serve cached response")
	}
	if _, ok := app.responseCacheLookup(selectionKey, detailKey); !ok {
		t.Fatalf("expected detail cache entry to remain on allow")
	}
}

func TestCachedPermissionAttributesUsesBuiltinCatalog(t *testing.T) {
	group, resource, verb, ok := cachedPermissionAttributes("Pod")
	if !ok {
		t.Fatalf("expected Pod cache permission attributes")
	}
	if group != "" || resource != "pods" || verb != "get" {
		t.Fatalf("unexpected Pod permission attributes: group=%q resource=%q verb=%q", group, resource, verb)
	}

	group, resource, verb, ok = cachedPermissionAttributes("HelmManifest")
	if !ok {
		t.Fatalf("expected Helm cache permission attributes")
	}
	if group != "" || resource != "secrets" || verb != "get" {
		t.Fatalf("unexpected Helm permission attributes: group=%q resource=%q verb=%q", group, resource, verb)
	}

	group, resource, verb, ok = cachedPermissionAttributes("Gateway")
	if !ok {
		t.Fatalf("expected Gateway cache permission attributes")
	}
	if group != "gateway.networking.k8s.io" || resource != "gateways" || verb != "get" {
		t.Fatalf("unexpected Gateway permission attributes: group=%q resource=%q verb=%q", group, resource, verb)
	}
}

func TestBuiltinObjectDetailFetchersHaveCachePermissionPolicy(t *testing.T) {
	for kind := range objectDetailFetchers {
		if kind == helmReleaseKind {
			continue
		}
		if _, ok := lookupBuiltinResourceByKind(kind); !ok {
			continue
		}
		if !isBuiltinDetailCachePermissionKind(kind) {
			t.Fatalf("built-in object detail kind %q is missing cache permission policy", kind)
		}
	}
}
