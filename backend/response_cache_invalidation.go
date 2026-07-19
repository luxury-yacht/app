package backend

import (
	"context"
	"strings"
	"time"

	corev1 "k8s.io/api/core/v1"
	apiextensionsinformers "k8s.io/apiextensions-apiserver/pkg/client/informers/externalversions"
	"k8s.io/apimachinery/pkg/api/meta"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/informers"
	"k8s.io/client-go/tools/cache"
	gatewayinformers "sigs.k8s.io/gateway-api/pkg/client/informers/externalversions"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/kind/kindregistry"
	"github.com/luxury-yacht/app/backend/objectcatalog"
	"github.com/luxury-yacht/app/backend/refresh/informer"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
	"github.com/luxury-yacht/app/backend/refresh/permissions"
	"github.com/luxury-yacht/app/backend/refresh/system"
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

// registerResponseCacheInvalidation wires informer-driven cache eviction for cached detail/YAML/helm responses.
func (a *App) registerResponseCacheInvalidation(subsystem *system.Subsystem, selectionKey string) {
	if a == nil || a.responseCache == nil || subsystem == nil || subsystem.InformerFactory == nil {
		return
	}
	shared := subsystem.InformerFactory.SharedInformerFactory()
	if shared == nil {
		return
	}
	gateway := subsystem.InformerFactory.GatewayInformerFactory()
	apiext := subsystem.InformerFactory.APIExtensionsInformerFactory()

	guard := responseCacheInvalidationGuard{
		hasSynced: func() bool {
			return subsystem.InformerFactory.HasSynced(context.Background())
		},
		now: time.Now,
	}

	// Use the informer factory as a permission checker to avoid triggering lazy informer
	// creation for cluster-scoped resources the user cannot list/watch.
	var perms permissions.ListWatchChecker = subsystem.InformerFactory

	// Ingest-owned (cut) kinds are no longer cached by the shared factory; their
	// invalidation flows from an ingest Catalog-half sink instead of a factory
	// informer handler. Register it once for all cut kinds.
	ingestOwned := kindregistry.IngestOwnedGVRs()
	if subsystem.IngestManager != nil {
		sink := a.ingestResponseCacheSink(selectionKey)
		for gvr := range ingestOwned {
			subsystem.IngestManager.AddCatalogSink(gvr, sink)
		}
	}

	// The ingest Catalog-half sink evicts a cut kind's own detail entry, but the Helm
	// cache eviction switches on the typed Secret/ConfigMap (release labels/type) the
	// catalog Summary can't carry. ConfigMap/Secret are cut, so that typed object now
	// lives only in the dedicated label-filtered helm-storage source — register the Helm
	// eviction on its informers so a release secret/configmap change still drops the
	// cached Helm release/manifest/values.
	a.registerHelmCacheInvalidation(subsystem.InformerFactory.HelmStorage(), selectionKey)

	// Every detail-cacheable kind drives response-cache eviction. The kind registry
	// is the single source; the informer is read generically from the factory its
	// group implies (Gateway-API, apiextensions, or the core shared factory), so no
	// per-kind informer accessor is wired here. Permissions are checked before
	// ForResource to avoid creating informers the user cannot list/watch. Ingest-owned
	// kinds are skipped — they are handled by the ingest sink above.
	for _, d := range kindregistry.All {
		if !d.DetailCacheable {
			continue
		}
		group := d.Identity.Group
		resource := d.Identity.Resource
		gvr := schema.GroupVersionResource{Group: group, Version: d.Identity.Version, Resource: resource}
		if _, cut := ingestOwned[gvr]; cut {
			continue
		}
		if !perms.CanListWatch(group, resource) {
			continue
		}
		var informer cache.SharedIndexInformer
		switch group {
		case gatewayAPIGroup:
			informer = gatewayFactoryInformer(gateway, gvr)
		case apiExtensionsGroup:
			informer = apiextensionsFactoryInformer(apiext, gvr)
		default:
			informer = sharedFactoryInformer(shared, gvr)
		}
		a.addResponseCacheInvalidationHandler(informer, selectionKey, d.Identity, guard)
	}

	if subsystem.ResourceStream != nil {
		// Use custom resource stream updates to evict cached YAML for dynamic resources.
		subsystem.ResourceStream.SetCustomResourceCacheInvalidator(func(ref resourcemodel.ResourceRef) {
			if ref.ClusterID == "" || ref.Group == "" || ref.Version == "" || ref.Kind == "" || ref.Name == "" {
				return
			}
			a.invalidateResponseCacheForResource(selectionKey, ref)
		})
	}
}

// gatewayAPIGroup and apiExtensionsGroup select the non-core informer factory for
// a kind in the response-cache invalidation loop; every other group reads from the
// core shared informer factory.
const (
	gatewayAPIGroup    = "gateway.networking.k8s.io"
	apiExtensionsGroup = "apiextensions.k8s.io"
)

// sharedFactoryInformer returns the core shared informer for a GVR, reading it
// generically via ForResource so no per-kind accessor is wired. Returns nil when
// the factory is absent or cannot serve the GVR; the caller's handler registration
// is a no-op on nil.
func sharedFactoryInformer(factory informers.SharedInformerFactory, gvr schema.GroupVersionResource) cache.SharedIndexInformer {
	if factory == nil {
		return nil
	}
	generic, err := factory.ForResource(gvr)
	if err != nil {
		return nil
	}
	return generic.Informer()
}

// gatewayFactoryInformer is sharedFactoryInformer for the Gateway-API factory.
func gatewayFactoryInformer(factory gatewayinformers.SharedInformerFactory, gvr schema.GroupVersionResource) cache.SharedIndexInformer {
	if factory == nil {
		return nil
	}
	generic, err := factory.ForResource(gvr)
	if err != nil {
		return nil
	}
	return generic.Informer()
}

// apiextensionsFactoryInformer is sharedFactoryInformer for the apiextensions factory.
func apiextensionsFactoryInformer(factory apiextensionsinformers.SharedInformerFactory, gvr schema.GroupVersionResource) cache.SharedIndexInformer {
	if factory == nil {
		return nil
	}
	generic, err := factory.ForResource(gvr)
	if err != nil {
		return nil
	}
	return generic.Informer()
}

// addResponseCacheInvalidationHandler evicts cached responses when an informer update arrives.
func (a *App) addResponseCacheInvalidationHandler(
	informer cache.SharedIndexInformer,
	selectionKey string,
	identity resourcekind.Identity,
	guard responseCacheInvalidationGuard,
) {
	if a == nil || a.responseCache == nil || informer == nil {
		return
	}
	handler := cache.ResourceEventHandlerFuncs{
		AddFunc: func(obj interface{}) {
			a.invalidateResponseCacheForObjectEvent(selectionKey, identity, obj, responseCacheInvalidationAdd, guard)
		},
		UpdateFunc: func(_, newObj interface{}) {
			a.invalidateResponseCacheForObjectEvent(selectionKey, identity, newObj, responseCacheInvalidationUpdate, guard)
		},
		DeleteFunc: func(obj interface{}) {
			a.invalidateResponseCacheForObjectEvent(selectionKey, identity, obj, responseCacheInvalidationDelete, guard)
		},
	}
	informer.AddEventHandler(handler)
}

// invalidateResponseCacheForObject clears cached detail/YAML/helm data for the given resource.
func (a *App) invalidateResponseCacheForObject(selectionKey string, identity resourcekind.Identity, obj interface{}) {
	a.invalidateResponseCacheForObjectEvent(
		selectionKey,
		identity,
		obj,
		responseCacheInvalidationUpdate,
		responseCacheInvalidationGuard{},
	)
}

// invalidateResponseCacheForObjectEvent clears cached detail/YAML/helm data for the given event.
func (a *App) invalidateResponseCacheForObjectEvent(
	selectionKey string,
	identity resourcekind.Identity,
	obj interface{},
	eventType responseCacheInvalidationEvent,
	guard responseCacheInvalidationGuard,
) {
	if a == nil || a.responseCache == nil {
		return
	}
	if identity.Version == "" || identity.Kind == "" || identity.Resource == "" {
		return
	}
	obj = unwrapCacheTombstone(obj)
	metaObj, err := meta.Accessor(obj)
	if err != nil || metaObj == nil {
		return
	}
	if shouldSkipWarmupInvalidation(guard, eventType, metaObj) {
		return
	}
	name := strings.TrimSpace(metaObj.GetName())
	if name == "" {
		return
	}
	namespace := strings.TrimSpace(metaObj.GetNamespace())
	a.invalidateResponseCacheForResource(selectionKey, resourcemodel.NewResourceRef(
		selectionKey,
		identity.Group,
		identity.Version,
		identity.Kind,
		identity.Resource,
		namespace,
		name,
		string(metaObj.GetUID()),
	))
	a.invalidateHelmCacheIfNeeded(selectionKey, obj)
}

// ingestResponseCacheSink returns an ingest Catalog-half sink that evicts a cut
// kind's cached detail entry on Upsert (resource changed) and Delete (resource
// removed). The reflector delivers the projected catalog Summary, which carries the
// kind/namespace/name the invalidation keys off — the same identity the
// shared-informer handler derived from the typed object.
func (a *App) ingestResponseCacheSink(selectionKey string) ingest.Sink {
	return ingestResponseCacheSink{app: a, selectionKey: selectionKey}
}

// ingestResponseCacheSink adapts response-cache invalidation to an ingest.Sink. It
// evicts on both Upsert and Delete: a cached detail is stale once the resource
// changes or disappears.
type ingestResponseCacheSink struct {
	app          *App
	selectionKey string
}

func (s ingestResponseCacheSink) Upsert(row interface{}) { s.invalidate(row) }
func (s ingestResponseCacheSink) Delete(row interface{}) { s.invalidate(row) }

func (s ingestResponseCacheSink) invalidate(row interface{}) {
	summary, ok := row.(objectcatalog.Summary)
	if !ok {
		return
	}
	s.app.invalidateResponseCacheForResource(s.selectionKey, resourcemodel.NewResourceRef(
		summary.ClusterID,
		summary.Group,
		summary.Version,
		summary.Kind,
		summary.Resource,
		summary.Namespace,
		summary.Name,
		summary.UID,
	))
}

// invalidateResponseCacheForResource clears cached detail/YAML entries for a resource key.
func (a *App) invalidateResponseCacheForResource(selectionKey string, ref resourcemodel.ResourceRef) {
	if ref.ClusterID == "" || ref.Version == "" || ref.Kind == "" || ref.Resource == "" || ref.Name == "" {
		return
	}
	a.invalidateResponseCacheForGVK(
		selectionKey,
		schema.GroupVersionKind{Group: ref.Group, Version: ref.Version, Kind: ref.Kind},
		ref.Namespace,
		ref.Name,
	)
}

// invalidateResponseCacheForGVK drops the exact GVK detail/header entries and
// the legacy kind-only detail key used by typed detail fetchers.
func (a *App) invalidateResponseCacheForGVK(selectionKey string, gvk schema.GroupVersionKind, namespace, name string) {
	if strings.TrimSpace(gvk.Kind) == "" || strings.TrimSpace(name) == "" {
		return
	}
	a.responseCacheDelete(selectionKey, objectDetailCacheKeyForGVK(gvk, namespace, name))
	a.responseCacheDelete(selectionKey, objectHeaderMetadataCacheKey(gvk, namespace, name))
	a.responseCacheDelete(selectionKey, objectDetailCacheKey(gvk.Kind, namespace, name))
}

// invalidateResponseCache drops the cached detail entry for the resource, plus
// the header-metadata entry keyed by the same GVK. The header metadata carries
// the object's resourceVersion (the object-details source clock) and its
// last-modified time; if it outlived the detail, the stale resourceVersion would
// re-pin the source-version ETag and the Details panel would keep serving 304s
// with stale content.
// (The legacy YAML response-cache entry was retired with App.GetObjectYAML —
// the GVK-aware fetch path doesn't write to the response cache.)
func (a *App) invalidateResponseCache(selectionKey, kind, namespace, name string) {
	a.responseCacheDelete(selectionKey, objectDetailCacheKey(kind, namespace, name))
	if gvk, ok := objectDetailFetcherGVKs[strings.ToLower(strings.TrimSpace(kind))]; ok {
		a.responseCacheDelete(selectionKey, objectDetailCacheKeyForGVK(gvk, namespace, name))
		a.responseCacheDelete(selectionKey, objectHeaderMetadataCacheKey(gvk, namespace, name))
	}
}

// registerHelmCacheInvalidation wires Helm-release cache eviction onto the
// label-filtered helm-storage informers (Secrets + ConfigMaps holding the full
// typed release objects). It replaces the shared configmap/secret informer handler
// the cutover removed: every release-storage change drops the cached Helm
// release/manifest/values for that release. A nil source or nil informer (the
// identity cannot list/watch that kind) is a no-op.
func (a *App) registerHelmCacheInvalidation(helm *informer.HelmStorageSource, selectionKey string) {
	if a == nil || a.responseCache == nil || helm == nil {
		return
	}
	handler := cache.ResourceEventHandlerFuncs{
		AddFunc:    func(obj interface{}) { a.invalidateHelmCacheIfNeeded(selectionKey, unwrapCacheTombstone(obj)) },
		UpdateFunc: func(_, newObj interface{}) { a.invalidateHelmCacheIfNeeded(selectionKey, unwrapCacheTombstone(newObj)) },
		DeleteFunc: func(obj interface{}) { a.invalidateHelmCacheIfNeeded(selectionKey, unwrapCacheTombstone(obj)) },
	}
	if inf := helm.SecretInformer(); inf != nil {
		inf.AddEventHandler(handler)
	}
	if inf := helm.ConfigMapInformer(); inf != nil {
		inf.AddEventHandler(handler)
	}
}

// invalidateHelmCacheIfNeeded evicts Helm release cache entries when a release secret/configmap changes.
func (a *App) invalidateHelmCacheIfNeeded(selectionKey string, obj interface{}) {
	switch typed := obj.(type) {
	case *corev1.Secret:
		if !isHelmReleaseObject(typed.Name, typed.Labels, string(typed.Type)) {
			return
		}
		a.invalidateHelmCache(selectionKey, typed.Namespace, resourcemodel.HelmReleaseName(typed.Name))
	case *corev1.ConfigMap:
		if !isHelmReleaseObject(typed.Name, typed.Labels, "") {
			return
		}
		a.invalidateHelmCache(selectionKey, typed.Namespace, resourcemodel.HelmReleaseName(typed.Name))
	}
}

// invalidateHelmCache clears cached Helm release details, manifests, and values.
func (a *App) invalidateHelmCache(selectionKey, namespace, name string) {
	if name == "" {
		return
	}
	a.responseCacheDelete(selectionKey, objectDetailCacheKey("HelmRelease", namespace, name))
	a.responseCacheDelete(selectionKey, objectDetailCacheKey("HelmManifest", namespace, name))
	a.responseCacheDelete(selectionKey, objectDetailCacheKey("HelmValues", namespace, name))
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
