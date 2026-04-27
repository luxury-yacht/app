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

	if _, _, _, ok := cachedPermissionAttributes("Gateway"); ok {
		t.Fatalf("Gateway is in the built-in catalog but should not be in the response-cache allowlist")
	}
}
