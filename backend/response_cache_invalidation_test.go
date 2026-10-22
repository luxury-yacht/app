package backend

import (
	"strings"
	"testing"
	"time"

	"k8s.io/apimachinery/pkg/runtime/schema"

	"github.com/luxury-yacht/app/backend/objectcatalog"
	"github.com/luxury-yacht/app/backend/resourcemodel"
)

// TestInvalidateResponseCacheEvictsHeaderMetadata proves an object change drops
// the cached header metadata too, not just the detail. The header metadata
// carries the object's resourceVersion (the object-details source clock); if it
// survived the change, the stale resourceVersion would re-pin the source-version
// ETag and the Details panel would keep serving a 304 with stale content.
func TestInvalidateResponseCacheEvictsHeaderMetadata(t *testing.T) {
	gateway := newResourceGatewayFixture().gateway
	gateway.responseCache = newResponseCache(time.Minute, 10)
	selectionKey := "cluster-a"

	gvk := schema.GroupVersionKind{Group: "apps", Version: "v1", Kind: "Deployment"}
	detailKey := objectDetailCacheKeyForGVK(gvk, "default", "demo")
	headerKey := objectHeaderMetadataCacheKey(gvk, "default", "demo")

	gateway.seedResponseCache(selectionKey, detailKey, "detail")
	gateway.seedResponseCache(selectionKey, headerKey, "header")

	// The ingest Catalog sink evicts by kind/namespace/name on every object change.
	gateway.invalidateResponseCacheForResource(selectionKey, resourcemodel.NewResourceRef(resourcemodel.ResourceRef{ClusterID: "cluster-a", Group: "apps", Version: "v1", Kind: "Deployment", Resource: "deployments", Namespace: "default", Name: "demo", UID: ""}))

	if _, ok := gateway.responseCacheLookup(selectionKey, detailKey); ok {
		t.Fatalf("expected detail cache entry to be evicted")
	}
	if _, ok := gateway.responseCacheLookup(selectionKey, headerKey); ok {
		t.Fatalf("expected header-metadata cache entry to be evicted")
	}
}

func TestInvalidateResponseCacheForGVKEvictsOnlyTheExactGVK(t *testing.T) {
	gateway := newResourceGatewayFixture().gateway
	gateway.responseCache = newResponseCache(time.Minute, 10)
	selectionKey := "cluster-a"

	customGVK := schema.GroupVersionKind{Group: "example.com", Version: "v1", Kind: "ConfigMap"}
	coreGVK := schema.GroupVersionKind{Group: "", Version: "v1", Kind: "ConfigMap"}
	customKey := objectDetailCacheKeyForGVK(customGVK, "default", "demo")
	customHeaderKey := objectHeaderMetadataCacheKey(customGVK, "default", "demo")
	coreGVKKey := objectDetailCacheKeyForGVK(coreGVK, "default", "demo")

	gateway.seedResponseCache(selectionKey, customKey, "custom")
	gateway.seedResponseCache(selectionKey, customHeaderKey, "custom-header")
	gateway.seedResponseCache(selectionKey, coreGVKKey, "core-gvk")

	gateway.invalidateResponseCacheForGVK(selectionKey, customGVK, "default", "demo")

	for _, key := range []string{customKey, customHeaderKey} {
		if _, ok := gateway.responseCacheLookup(selectionKey, key); ok {
			t.Fatalf("expected exact custom GVK cache entry %q to be evicted", key)
		}
	}
	if _, ok := gateway.responseCacheLookup(selectionKey, coreGVKKey); !ok {
		t.Fatalf("expected built-in GVK cache entry with colliding kind to remain")
	}
}

// TestIngestResponseCacheSinkEvictsOnUpsertAndDelete proves the owned-reflector
// invalidation path: a cut kind's ingest Catalog-half sink evicts the cached detail
// entry on both Upsert (the resource changed) and Delete (the resource was removed),
// fed the projected Summary, not the
// typed object.
func TestIngestResponseCacheSinkEvictsOnUpsertAndDelete(t *testing.T) {
	gateway := newResourceGatewayFixture().gateway
	gateway.responseCache = newResponseCache(time.Minute, 10)
	selectionKey := "cluster-a"

	sink := newResponseCacheSink(responseCacheEvictionTargets{gateway: gateway, selectionKey: selectionKey})

	upsertKey := liveDetailCacheKey("ResourceQuota", "default", "rq-a")
	gateway.seedResponseCache(selectionKey, upsertKey, "detail")
	sink.Upsert(objectcatalog.Summary{Ref: resourcemodel.ResourceRef{ClusterID: "cluster-a", Version: "v1", Kind: "ResourceQuota", Resource: "resourcequotas", Namespace: "default", Name: "rq-a"}})
	if _, ok := gateway.responseCacheLookup(selectionKey, upsertKey); ok {
		t.Fatalf("expected detail cache entry to be evicted on ingest Upsert")
	}

	deleteKey := liveDetailCacheKey("LimitRange", "default", "lr-b")
	gateway.seedResponseCache(selectionKey, deleteKey, "detail")
	sink.Delete(objectcatalog.Summary{Ref: resourcemodel.ResourceRef{ClusterID: "cluster-a", Version: "v1", Kind: "LimitRange", Resource: "limitranges", Namespace: "default", Name: "lr-b"}})
	if _, ok := gateway.responseCacheLookup(selectionKey, deleteKey); ok {
		t.Fatalf("expected detail cache entry to be evicted on ingest Delete")
	}
}

// Workload details embed their pods, so a pod change clears the cached details
// of every kind that lists pods in the pod's namespace, and nothing else. A
// stale pod list would hide a new pod's log lines.
func TestPodChangeClearsCachedDetailsThatListPods(t *testing.T) {
	gateway := newResourceGatewayFixture().gateway
	gateway.responseCache = newResponseCache(time.Minute, 50)
	selectionKey := "cluster-a"
	sink := newResponseCacheSink(responseCacheEvictionTargets{gateway: gateway, selectionKey: selectionKey})
	deployment := schema.GroupVersionKind{Group: "apps", Version: "v1", Kind: "Deployment"}
	cleared := []string{
		objectDetailCacheKeyForGVK(deployment, "team-a", "web"),
		objectDetailCacheKeyForGVK(schema.GroupVersionKind{Group: "batch", Version: "v1", Kind: "CronJob"}, "team-a", "backup"),
		objectDetailCacheKeyForGVK(schema.GroupVersionKind{Group: "batch", Version: "v1", Kind: "Job"}, "team-a", "migrate"),
	}
	kept := []string{
		objectDetailCacheKeyForGVK(deployment, "team-b", "web"),
		objectDetailCacheKeyForGVK(schema.GroupVersionKind{Version: "v1", Kind: "ConfigMap"}, "team-a", "settings"),
	}
	seed := func() {
		for _, key := range append(append([]string{}, cleared...), kept...) {
			gateway.seedResponseCache(selectionKey, key, "detail")
		}
	}
	pod := objectcatalog.Summary{Ref: resourcemodel.ResourceRef{ClusterID: selectionKey, Version: "v1", Kind: "Pod", Resource: "pods", Namespace: "team-a", Name: "web-abc"}}

	for name, change := range map[string]func(interface{}){"upsert": sink.Upsert, "delete": sink.Delete} {
		seed()
		change(pod)
		for _, key := range cleared {
			if _, ok := gateway.responseCacheLookup(selectionKey, key); ok {
				t.Fatalf("%s: expected %s to be cleared by a pod change in its namespace", name, key)
			}
		}
		for _, key := range kept {
			if _, ok := gateway.responseCacheLookup(selectionKey, key); !ok {
				t.Fatalf("%s: expected %s to stay cached", name, key)
			}
		}
	}
}

// liveDetailCacheKey is the detail cache key the object panel writes for a
// built-in kind: its typed fetcher's exact GVK.
func liveDetailCacheKey(kind, namespace, name string) string {
	return objectDetailCacheKeyForGVK(objectDetailFetcherGVKs[strings.ToLower(kind)], namespace, name)
}
