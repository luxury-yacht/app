package backend

import (
	"strings"
	"time"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/meta"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/tools/cache"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/kind/kindregistry"
	"github.com/luxury-yacht/app/backend/resourcekind"
	"github.com/luxury-yacht/app/backend/resourcemodel"
)

const (
	helmReleaseSecretType = "helm.sh/release.v1"
	helmReleaseOwnerLabel = "owner"
	helmReleaseOwnerValue = "helm"
)

type responseCacheInvalidationEvent int

const (
	responseCacheInvalidationAdd responseCacheInvalidationEvent = iota
	responseCacheInvalidationUpdate
	responseCacheInvalidationDelete
)

// responseCacheInvalidationGuard provides sync/clock hooks for warm-up filtering.
type responseCacheInvalidationGuard struct {
	hasSynced func() bool
	now       func() time.Time
}

// hasResponseCache reports whether the gateway caches responses at all; without
// a cache there is nothing to evict and no eviction handler to register.
func (g *ResourceGateway) hasResponseCache() bool {
	return g != nil && g.responseCache != nil
}

// invalidateResponseCacheForObjectEvent clears cached detail/YAML/helm data for
// the given event and returns the object whose details it evicted.
func (g *ResourceGateway) invalidateResponseCacheForObjectEvent(
	selectionKey string,
	identity resourcekind.Identity,
	obj interface{},
	eventType responseCacheInvalidationEvent,
	guard responseCacheInvalidationGuard,
) (resourcemodel.ResourceRef, bool) {
	if g == nil || g.responseCache == nil {
		return resourcemodel.ResourceRef{}, false
	}
	if identity.Version == "" || identity.Kind == "" || identity.Resource == "" {
		return resourcemodel.ResourceRef{}, false
	}
	obj = unwrapCacheTombstone(obj)
	metaObj, err := meta.Accessor(obj)
	if err != nil || metaObj == nil {
		return resourcemodel.ResourceRef{}, false
	}
	if shouldSkipWarmupInvalidation(guard, eventType, metaObj) {
		return resourcemodel.ResourceRef{}, false
	}
	name := strings.TrimSpace(metaObj.GetName())
	if name == "" {
		return resourcemodel.ResourceRef{}, false
	}
	namespace := strings.TrimSpace(metaObj.GetNamespace())
	ref := resourcemodel.NewResourceRef(resourcemodel.ResourceRef{ClusterID: selectionKey, Group: identity.Group, Version: identity.Version, Kind: identity.Kind, Resource: identity.Resource, Namespace: namespace, Name: name, UID: string(metaObj.GetUID())})
	g.invalidateResponseCacheForResource(selectionKey, ref)
	g.invalidateHelmCacheIfNeeded(selectionKey, obj)
	return ref, true
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

// invalidateHelmCacheIfNeeded evicts Helm release cache entries when a release
// secret/configmap changes, and returns the release whose details it evicted.
func (g *ResourceGateway) invalidateHelmCacheIfNeeded(selectionKey string, obj interface{}) (namespace, release string, evicted bool) {
	switch typed := obj.(type) {
	case *corev1.Secret:
		if !isHelmReleaseObject(typed.Name, typed.Labels, string(typed.Type)) {
			return "", "", false
		}
		namespace, release = typed.Namespace, resourcemodel.HelmReleaseName(typed.Name)
	case *corev1.ConfigMap:
		if !isHelmReleaseObject(typed.Name, typed.Labels, "") {
			return "", "", false
		}
		namespace, release = typed.Namespace, resourcemodel.HelmReleaseName(typed.Name)
	default:
		return "", "", false
	}
	if release == "" {
		return "", "", false
	}
	g.invalidateHelmCache(selectionKey, namespace, release)
	return namespace, release, true
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

// unwrapCacheTombstone normalizes deleted informer events to the underlying object.
func unwrapCacheTombstone(obj interface{}) interface{} {
	switch typed := obj.(type) {
	case cache.DeletedFinalStateUnknown:
		return typed.Obj
	case *cache.DeletedFinalStateUnknown:
		return typed.Obj
	default:
		return obj
	}
}

// shouldSkipWarmupInvalidation skips add events for older objects during informer warm-up.
func shouldSkipWarmupInvalidation(
	guard responseCacheInvalidationGuard,
	eventType responseCacheInvalidationEvent,
	metaObj metav1.Object,
) bool {
	if eventType != responseCacheInvalidationAdd {
		return false
	}
	if guard.hasSynced == nil {
		return false
	}
	if guard.hasSynced() {
		return false
	}
	if metaObj == nil {
		return false
	}
	createdAt := metaObj.GetCreationTimestamp()
	if createdAt.IsZero() {
		return false
	}
	now := time.Now()
	if guard.now != nil {
		now = guard.now()
	}
	age := now.Sub(createdAt.Time)
	if age < 0 {
		return false
	}
	return age >= config.ResponseCacheInvalidationWarmupAge
}

func isHelmReleaseObject(name string, labels map[string]string, secretType string) bool {
	if secretType == helmReleaseSecretType {
		return true
	}
	if labels != nil {
		if strings.EqualFold(labels[helmReleaseOwnerLabel], helmReleaseOwnerValue) {
			return true
		}
		if strings.EqualFold(labels[strings.ToUpper(helmReleaseOwnerLabel)], helmReleaseOwnerValue) {
			return true
		}
	}
	return strings.HasPrefix(name, resourcemodel.HelmReleaseNamePrefix)
}
