package backend

import (
	"context"
	"testing"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
	cgofake "k8s.io/client-go/kubernetes/fake"

	"github.com/luxury-yacht/app/backend/objectcatalog"
	"github.com/luxury-yacht/app/backend/refresh/informer"
	"github.com/luxury-yacht/app/backend/refresh/permissions"
)

func TestInvalidateResponseCacheForObjectEvictsDetailAndYAML(t *testing.T) {
	app := NewApp()
	app.responseCache = newResponseCache(time.Minute, 10)
	selectionKey := "cluster-a"

	configMap := &corev1.ConfigMap{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "demo",
			Namespace: "default",
		},
	}

	detailKey := objectDetailCacheKey("ConfigMap", "default", "demo")
	app.responseCacheStore(selectionKey, detailKey, "detail")

	app.invalidateResponseCacheForObject(selectionKey, "ConfigMap", configMap)

	if _, ok := app.responseCacheLookup(selectionKey, detailKey); ok {
		t.Fatalf("expected detail cache entry to be evicted")
	}
}

func TestInvalidateResponseCacheForObjectEvictsHelmCaches(t *testing.T) {
	app := NewApp()
	app.responseCache = newResponseCache(time.Minute, 10)
	selectionKey := "cluster-a"

	secret := &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "sh.helm.release.v1.demo.v1",
			Namespace: "default",
		},
		Type: corev1.SecretType(helmReleaseSecretType),
	}

	releaseKey := objectDetailCacheKey("HelmRelease", "default", "demo")
	manifestKey := objectDetailCacheKey("HelmManifest", "default", "demo")
	valuesKey := objectDetailCacheKey("HelmValues", "default", "demo")

	app.responseCacheStore(selectionKey, releaseKey, "details")
	app.responseCacheStore(selectionKey, manifestKey, "manifest")
	app.responseCacheStore(selectionKey, valuesKey, "values")

	app.invalidateResponseCacheForObject(selectionKey, "Secret", secret)

	if _, ok := app.responseCacheLookup(selectionKey, releaseKey); ok {
		t.Fatalf("expected helm release cache entry to be evicted")
	}
	if _, ok := app.responseCacheLookup(selectionKey, manifestKey); ok {
		t.Fatalf("expected helm manifest cache entry to be evicted")
	}
	if _, ok := app.responseCacheLookup(selectionKey, valuesKey); ok {
		t.Fatalf("expected helm values cache entry to be evicted")
	}
}

func TestRegisterHelmCacheInvalidationEvictsViaHelmStorageInformer(t *testing.T) {
	app := NewApp()
	app.responseCache = newResponseCache(time.Minute, 10)
	selectionKey := "cluster-a"

	releaseKey := objectDetailCacheKey("HelmRelease", "default", "demo")
	manifestKey := objectDetailCacheKey("HelmManifest", "default", "demo")
	app.responseCacheStore(selectionKey, releaseKey, "details")
	app.responseCacheStore(selectionKey, manifestKey, "manifest")

	// Build the production helm-storage source from a fake client and register the
	// Helm cache eviction on it, proving the cut-config path (no shared configmap/
	// secret informer) still evicts the Helm cache on a release secret change.
	checker := permissions.NewCheckerWithReview("test", time.Minute, func(_ context.Context, _, _, _ string) (bool, error) {
		return true, nil
	})
	client := cgofake.NewClientset()
	factory := informer.New(client, nil, time.Minute, checker)
	app.registerHelmCacheInvalidation(factory.HelmStorage(), selectionKey)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := factory.Start(ctx); err != nil {
		t.Fatalf("factory start: %v", err)
	}

	secret := &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "sh.helm.release.v1.demo.v1",
			Namespace: "default",
			Labels:    map[string]string{"owner": "helm"},
		},
		Type: corev1.SecretType(helmReleaseSecretType),
	}
	if _, err := client.CoreV1().Secrets("default").Create(ctx, secret, metav1.CreateOptions{}); err != nil {
		t.Fatalf("create release secret: %v", err)
	}

	// The informer delivers the add asynchronously; poll until the eviction lands.
	deadline := time.Now().Add(3 * time.Second)
	for {
		_, releaseStillCached := app.responseCacheLookup(selectionKey, releaseKey)
		_, manifestStillCached := app.responseCacheLookup(selectionKey, manifestKey)
		if !releaseStillCached && !manifestStillCached {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("expected helm release/manifest cache evicted via helm-storage informer (release=%v manifest=%v)", releaseStillCached, manifestStillCached)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func TestInvalidateResponseCacheSkipsWarmupAddsForOldObjects(t *testing.T) {
	app := NewApp()
	app.responseCache = newResponseCache(time.Minute, 10)
	selectionKey := "cluster-a"

	now := time.Now()
	configMap := &corev1.ConfigMap{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "demo",
			Namespace:         "default",
			CreationTimestamp: metav1.NewTime(now.Add(-2 * time.Minute)),
		},
	}

	detailKey := objectDetailCacheKey("ConfigMap", "default", "demo")
	app.responseCacheStore(selectionKey, detailKey, "detail")

	guard := responseCacheInvalidationGuard{
		hasSynced: func() bool { return false },
		now:       func() time.Time { return now },
	}
	app.invalidateResponseCacheForObjectEvent(
		selectionKey,
		"ConfigMap",
		configMap,
		responseCacheInvalidationAdd,
		guard,
	)

	if _, ok := app.responseCacheLookup(selectionKey, detailKey); !ok {
		t.Fatalf("expected detail cache entry to remain during warm-up add")
	}
}

func TestInvalidateResponseCacheSkipsKindsOnUpdate(t *testing.T) {
	app := NewApp()
	app.responseCache = newResponseCache(time.Minute, 10)
	selectionKey := "cluster-a"

	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "demo",
			Namespace: "default",
		},
	}

	detailKey := objectDetailCacheKey("Pod", "default", "demo")
	app.responseCacheStore(selectionKey, detailKey, "detail")

	guard := responseCacheInvalidationGuard{
		hasSynced: func() bool { return true },
		now:       time.Now,
	}
	app.invalidateResponseCacheForObjectEvent(
		selectionKey,
		"Pod",
		pod,
		responseCacheInvalidationUpdate,
		guard,
	)

	if _, ok := app.responseCacheLookup(selectionKey, detailKey); !ok {
		t.Fatalf("expected detail cache entry to remain for skipped kinds")
	}
}

func TestInvalidateResponseCacheForGVKEvictsExactAndLegacyKindKeys(t *testing.T) {
	app := NewApp()
	app.responseCache = newResponseCache(time.Minute, 10)
	selectionKey := "cluster-a"

	customGVK := schema.GroupVersionKind{Group: "example.com", Version: "v1", Kind: "ConfigMap"}
	coreGVK := schema.GroupVersionKind{Group: "", Version: "v1", Kind: "ConfigMap"}
	customKey := objectDetailCacheKeyForGVK(customGVK, "default", "demo")
	coreGVKKey := objectDetailCacheKeyForGVK(coreGVK, "default", "demo")
	coreKindKey := objectDetailCacheKey("ConfigMap", "default", "demo")

	app.responseCacheStore(selectionKey, customKey, "custom")
	app.responseCacheStore(selectionKey, coreGVKKey, "core-gvk")
	app.responseCacheStore(selectionKey, coreKindKey, "core-kind")

	app.invalidateResponseCacheForGVK(selectionKey, customGVK, "default", "demo")

	if _, ok := app.responseCacheLookup(selectionKey, customKey); ok {
		t.Fatalf("expected exact custom GVK cache entry to be evicted")
	}
	if _, ok := app.responseCacheLookup(selectionKey, coreGVKKey); !ok {
		t.Fatalf("expected built-in GVK cache entry with colliding kind to remain")
	}
	if _, ok := app.responseCacheLookup(selectionKey, coreKindKey); ok {
		t.Fatalf("expected legacy kind cache entry with colliding kind to be evicted")
	}
}

func TestInvalidateResponseCacheForGVKEvictsBuiltinLegacyAndGVKKeys(t *testing.T) {
	app := NewApp()
	app.responseCache = newResponseCache(time.Minute, 10)
	selectionKey := "cluster-a"

	gvk := schema.GroupVersionKind{Group: "apps", Version: "v1", Kind: "Deployment"}
	gvkKey := objectDetailCacheKeyForGVK(gvk, "default", "demo")
	kindKey := objectDetailCacheKey("Deployment", "default", "demo")

	app.responseCacheStore(selectionKey, gvkKey, "gvk")
	app.responseCacheStore(selectionKey, kindKey, "kind")

	app.invalidateResponseCacheForGVK(selectionKey, gvk, "default", "demo")

	if _, ok := app.responseCacheLookup(selectionKey, gvkKey); ok {
		t.Fatalf("expected built-in GVK cache entry to be evicted")
	}
	if _, ok := app.responseCacheLookup(selectionKey, kindKey); ok {
		t.Fatalf("expected built-in legacy kind cache entry to be evicted")
	}
}

// TestIngestResponseCacheSinkEvictsOnUpsertAndDelete proves the owned-reflector
// invalidation path: a cut kind's ingest Catalog-half sink evicts the cached detail
// entry on both Upsert (the resource changed) and Delete (the resource was removed),
// exactly as the shared-informer handler did — but fed the projected Summary, not the
// typed object.
func TestIngestResponseCacheSinkEvictsOnUpsertAndDelete(t *testing.T) {
	app := NewApp()
	app.responseCache = newResponseCache(time.Minute, 10)
	selectionKey := "cluster-a"

	sink := app.ingestResponseCacheSink(selectionKey)

	upsertKey := objectDetailCacheKey("ResourceQuota", "default", "rq-a")
	app.responseCacheStore(selectionKey, upsertKey, "detail")
	sink.Upsert(objectcatalog.Summary{Kind: "ResourceQuota", Namespace: "default", Name: "rq-a"})
	if _, ok := app.responseCacheLookup(selectionKey, upsertKey); ok {
		t.Fatalf("expected detail cache entry to be evicted on ingest Upsert")
	}

	deleteKey := objectDetailCacheKey("LimitRange", "default", "lr-b")
	app.responseCacheStore(selectionKey, deleteKey, "detail")
	sink.Delete(objectcatalog.Summary{Kind: "LimitRange", Namespace: "default", Name: "lr-b"})
	if _, ok := app.responseCacheLookup(selectionKey, deleteKey); ok {
		t.Fatalf("expected detail cache entry to be evicted on ingest Delete")
	}
}
