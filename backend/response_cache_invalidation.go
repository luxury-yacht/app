package backend

import (
	"strings"

	"k8s.io/apimachinery/pkg/runtime/schema"

	"github.com/luxury-yacht/app/backend/kind/kindregistry"
	"github.com/luxury-yacht/app/backend/resourcemodel"
)

// hasResponseCache reports whether the gateway caches responses at all; without
// a cache there is nothing to evict and no eviction handler to register.
func (g *ResourceGateway) hasResponseCache() bool {
	return g != nil && g.responseCache != nil
}

func isPodRef(ref resourcemodel.ResourceRef) bool {
	return ref.Group == "" && ref.Kind == "Pod" && ref.Namespace != ""
}

// podListingDetailKinds are the kinds whose details embed their pods.
var podListingDetailKinds = func() []schema.GroupVersionKind {
	var kinds []schema.GroupVersionKind
	for _, d := range kindregistry.All {
		if d.DetailListsPods {
			kinds = append(kinds, schema.GroupVersionKind{Group: d.Identity.Group, Version: d.Identity.Version, Kind: d.Identity.Kind})
		}
	}
	return kinds
}()

// invalidatePodListingDetails evicts the cached details of every kind that
// lists pods in the namespace. A pod's catalog row does not name its workload,
// so all of them are evicted; details are fetched only for open panels.
func (g *ResourceGateway) invalidatePodListingDetails(selectionKey, namespace string) {
	for _, gvk := range podListingDetailKinds {
		g.responseCacheDeletePrefix(selectionKey, objectDetailCacheKeyForGVK(gvk, namespace, ""))
	}
}

// invalidateResponseCacheForResource clears cached detail/YAML entries for a resource key.
func (g *ResourceGateway) invalidateResponseCacheForResource(selectionKey string, ref resourcemodel.ResourceRef) {
	if ref.ClusterID == "" || ref.Version == "" || ref.Kind == "" || ref.Resource == "" || ref.Name == "" {
		return
	}
	g.invalidateResponseCacheForGVK(
		selectionKey,
		schema.GroupVersionKind{Group: ref.Group, Version: ref.Version, Kind: ref.Kind},
		ref.Namespace,
		ref.Name,
	)
}

// invalidateResponseCacheForGVK drops the exact GVK detail entry and the
// header-metadata entry keyed by the same GVK. The header metadata carries the
// object's resourceVersion (the object-details source clock) and its
// last-modified time; if it outlived the detail, the stale resourceVersion would
// re-pin the source-version ETag and the Details panel would keep serving 304s
// with stale content.
func (g *ResourceGateway) invalidateResponseCacheForGVK(selectionKey string, gvk schema.GroupVersionKind, namespace, name string) {
	if strings.TrimSpace(gvk.Kind) == "" || strings.TrimSpace(name) == "" {
		return
	}
	g.responseCacheDelete(selectionKey, objectDetailCacheKeyForGVK(gvk, namespace, name))
	g.responseCacheDelete(selectionKey, objectHeaderMetadataCacheKey(gvk, namespace, name))
}

// invalidateHelmCache clears cached Helm release details, manifests, and values.
func (g *ResourceGateway) invalidateHelmCache(selectionKey, namespace, name string) {
	if name == "" {
		return
	}
	g.responseCacheDelete(selectionKey, objectDetailCacheKey("HelmRelease", namespace, name))
	g.responseCacheDelete(selectionKey, objectDetailCacheKey("HelmManifest", namespace, name))
	g.responseCacheDelete(selectionKey, objectDetailCacheKey("HelmValues", namespace, name))
}
