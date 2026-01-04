package backend

import (
	"testing"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
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
	yamlKey := objectYAMLCacheKey("ConfigMap", "default", "demo")

	app.responseCacheStore(selectionKey, detailKey, "detail")
	app.responseCacheStore(selectionKey, yamlKey, "yaml")

	app.invalidateResponseCacheForObject(selectionKey, "ConfigMap", configMap)

	if _, ok := app.responseCacheLookup(selectionKey, detailKey); ok {
		t.Fatalf("expected detail cache entry to be evicted")
	}
	if _, ok := app.responseCacheLookup(selectionKey, yamlKey); ok {
		t.Fatalf("expected yaml cache entry to be evicted")
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
	yamlKey := objectYAMLCacheKey("ConfigMap", "default", "demo")

	app.responseCacheStore(selectionKey, detailKey, "detail")
	app.responseCacheStore(selectionKey, yamlKey, "yaml")

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
	if _, ok := app.responseCacheLookup(selectionKey, yamlKey); !ok {
		t.Fatalf("expected yaml cache entry to remain during warm-up add")
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
	yamlKey := objectYAMLCacheKey("Pod", "default", "demo")

	app.responseCacheStore(selectionKey, detailKey, "detail")
	app.responseCacheStore(selectionKey, yamlKey, "yaml")

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
	if _, ok := app.responseCacheLookup(selectionKey, yamlKey); !ok {
		t.Fatalf("expected yaml cache entry to remain for skipped kinds")
	}
}
