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
	yamlKey := objectYAMLCacheKey("HelmManifest", "default", "demo")
	app.responseCacheStore(selectionKey, detailKey, "manifest")
	app.responseCacheStore(selectionKey, yamlKey, "yaml")

	deps := common.Dependencies{Context: context.Background()}
	if allowed := app.canServeCachedResponse(context.Background(), deps, selectionKey, "HelmManifest", "default", "demo"); allowed {
		t.Fatalf("expected permission denial to block cached response")
	}
	if _, ok := app.responseCacheLookup(selectionKey, detailKey); ok {
		t.Fatalf("expected detail cache entry to be evicted on permission deny")
	}
	if _, ok := app.responseCacheLookup(selectionKey, yamlKey); ok {
		t.Fatalf("expected yaml cache entry to be evicted on permission deny")
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
	yamlKey := objectYAMLCacheKey("HelmValues", "default", "demo")
	app.responseCacheStore(selectionKey, detailKey, "values")
	app.responseCacheStore(selectionKey, yamlKey, "yaml")

	deps := common.Dependencies{Context: context.Background()}
	if allowed := app.canServeCachedResponse(context.Background(), deps, selectionKey, "HelmValues", "default", "demo"); !allowed {
		t.Fatalf("expected permission allow to serve cached response")
	}
	if _, ok := app.responseCacheLookup(selectionKey, detailKey); !ok {
		t.Fatalf("expected detail cache entry to remain on allow")
	}
	if _, ok := app.responseCacheLookup(selectionKey, yamlKey); !ok {
		t.Fatalf("expected yaml cache entry to remain on allow")
	}
}
