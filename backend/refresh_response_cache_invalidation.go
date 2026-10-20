package backend

import (
	"context"
	"time"

	apiextensionsinformers "k8s.io/apiextensions-apiserver/pkg/client/informers/externalversions"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/informers"
	"k8s.io/client-go/tools/cache"
	gatewayinformers "sigs.k8s.io/gateway-api/pkg/client/informers/externalversions"

	"github.com/luxury-yacht/app/backend/kind/kindregistry"
	"github.com/luxury-yacht/app/backend/objectcatalog"
	"github.com/luxury-yacht/app/backend/refresh/informer"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
	"github.com/luxury-yacht/app/backend/refresh/permissions"
	"github.com/luxury-yacht/app/backend/refresh/snapshot"
	"github.com/luxury-yacht/app/backend/refresh/system"
	"github.com/luxury-yacht/app/backend/resourcekind"
	"github.com/luxury-yacht/app/backend/resourcemodel"
)

// responseCacheInvalidator is the gateway's eviction surface. Refresh owns the
// handlers that call it (refresh-system.md: Refresh may invoke gateway
// invalidators; the gateway never calls back into Refresh).
type responseCacheInvalidator interface {
	hasResponseCache() bool
	invalidateResponseCacheForObjectEvent(string, resourcekind.Identity, interface{}, responseCacheInvalidationEvent, responseCacheInvalidationGuard) (resourcemodel.ResourceRef, bool)
	invalidateResponseCacheForResource(string, resourcemodel.ResourceRef)
	invalidatePodListingDetails(selectionKey, namespace string)
	invalidateHelmCacheIfNeeded(string, interface{}) (namespace, release string, evicted bool)
}

// registerResponseCacheInvalidation wires informer- and ingest-driven eviction
// of cached detail/YAML/helm responses onto the subsystem's sources. Each
// handler evicts through the gateway and then records the change for the
// object-details doorbell, in that order, so a signal-triggered read never
// returns the pre-change copy.
func (a *RefreshCoordinator) registerResponseCacheInvalidation(subsystem *system.Subsystem, selectionKey string) {
	if a == nil || a.resources == nil || !a.resources.hasResponseCache() || subsystem == nil || subsystem.InformerFactory == nil {
		return
	}
	shared := subsystem.InformerFactory.SharedInformerFactory()
	if shared == nil {
		return
	}
	targets := responseCacheEvictionTargets{
		gateway:      a.resources,
		notifier:     subsystem.ObjectDetailsNotifier,
		selectionKey: selectionKey,
	}
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
	registerIngestResponseCacheInvalidation(subsystem, targets, ingestOwned)

	// The ingest Catalog-half sink evicts a cut kind's own detail entry, but the Helm
	// cache eviction switches on the typed Secret/ConfigMap (release labels/type) the
	// catalog Summary can't carry. ConfigMap/Secret are cut, so that typed object now
	// lives only in the dedicated label-filtered helm-storage source — register the Helm
	// eviction on its informers so a release secret/configmap change still drops the
	// cached Helm release/manifest/values.
	registerHelmCacheInvalidation(subsystem.InformerFactory.HelmStorage(), targets)

	registerDescriptorResponseCacheInvalidation(
		shared,
		subsystem.InformerFactory.GatewayInformerFactory(),
		subsystem.InformerFactory.APIExtensionsInformerFactory(),
		targets, guard, perms, ingestOwned,
	)
	registerCustomResourceCacheInvalidation(subsystem, targets)
}

// responseCacheEvictionTargets is what every eviction handler acts on: the
// gateway's cache for one cluster, then that cluster's details doorbell.
type responseCacheEvictionTargets struct {
	gateway      responseCacheInvalidator
	notifier     *snapshot.ObjectDetailsChangeNotifier
	selectionKey string
}

func registerIngestResponseCacheInvalidation(
	subsystem *system.Subsystem,
	targets responseCacheEvictionTargets,
	ingestOwned map[schema.GroupVersionResource]struct{},
) {
	if subsystem.IngestManager == nil {
		return
	}
	sink := newResponseCacheSink(targets)
	for gvr := range ingestOwned {
		subsystem.IngestManager.AddCatalogSink(gvr, sink)
	}
}

func registerDescriptorResponseCacheInvalidation(
	shared informers.SharedInformerFactory,
	gateway gatewayinformers.SharedInformerFactory,
	apiext apiextensionsinformers.SharedInformerFactory,
	targets responseCacheEvictionTargets,
	guard responseCacheInvalidationGuard,
	perms permissions.ListWatchChecker,
	ingestOwned map[schema.GroupVersionResource]struct{},
) {
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
		addResponseCacheInvalidationHandler(informer, targets, d.Identity, guard)
	}
}

func registerCustomResourceCacheInvalidation(subsystem *system.Subsystem, targets responseCacheEvictionTargets) {
	if subsystem.IngestManager == nil {
		return
	}
	// This is wired before generation startup, so the initial LIST and later
	// mutations invalidate responses before catalog publication and its doorbell.
	subsystem.IngestManager.SetDynamicCatalogSink(newResponseCacheSink(targets))
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

// addResponseCacheInvalidationHandler evicts cached responses when an informer
// delivery arrives, then rings the object's details doorbell unless the update
// is a resync echo. Eviction itself stays unconditional.
func addResponseCacheInvalidationHandler(
	informer cache.SharedIndexInformer,
	targets responseCacheEvictionTargets,
	identity resourcekind.Identity,
	guard responseCacheInvalidationGuard,
) {
	if informer == nil {
		return
	}
	evict := func(obj interface{}, event responseCacheInvalidationEvent, changed bool) {
		ref, evicted := targets.gateway.invalidateResponseCacheForObjectEvent(targets.selectionKey, identity, obj, event, guard)
		if evicted && changed {
			targets.notifier.ObjectChanged(identity.GVK(), ref.Namespace, ref.Name)
		}
	}
	informer.AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc: func(obj interface{}) {
			evict(obj, responseCacheInvalidationAdd, true)
		},
		UpdateFunc: func(oldObj, newObj interface{}) {
			evict(newObj, responseCacheInvalidationUpdate, !snapshot.InformerUpdateIsEcho(oldObj, newObj))
		},
		DeleteFunc: func(obj interface{}) {
			evict(obj, responseCacheInvalidationDelete, true)
		},
	})
}

// registerHelmCacheInvalidation wires Helm-release cache eviction onto the
// label-filtered helm-storage informers (Secrets + ConfigMaps holding the full
// typed release objects): every release-storage change drops the cached Helm
// release/manifest/values for that release, then rings the release's details
// doorbell. A nil source or nil informer (the identity cannot list/watch that
// kind) is a no-op.
func registerHelmCacheInvalidation(helm *informer.HelmStorageSource, targets responseCacheEvictionTargets) {
	if helm == nil || targets.gateway == nil || !targets.gateway.hasResponseCache() {
		return
	}
	evict := func(obj interface{}, changed bool) {
		namespace, release, evicted := targets.gateway.invalidateHelmCacheIfNeeded(targets.selectionKey, unwrapCacheTombstone(obj))
		if evicted && changed {
			targets.notifier.ObjectChanged(resourcemodel.HelmReleaseGVK, namespace, release)
		}
	}
	handler := cache.ResourceEventHandlerFuncs{
		AddFunc:    func(obj interface{}) { evict(obj, true) },
		UpdateFunc: func(oldObj, newObj interface{}) { evict(newObj, !snapshot.InformerUpdateIsEcho(oldObj, newObj)) },
		DeleteFunc: func(obj interface{}) { evict(obj, true) },
	}
	if inf := helm.SecretInformer(); inf != nil {
		inf.AddEventHandler(handler)
	}
	if inf := helm.ConfigMapInformer(); inf != nil {
		inf.AddEventHandler(handler)
	}
}

// responseCacheSink adapts response-cache eviction to an ingest Catalog-half
// sink. The reflector delivers the projected catalog Summary, which carries the
// identity eviction keys off. It evicts on every upsert and delete — a cached
// detail is stale once the resource changes or disappears — and rings the
// details doorbell only for real changes: as an ingest.UpsertChanger it sees the
// row an upsert replaces, so a relist's unchanged row rings nothing.
type responseCacheSink struct {
	targets responseCacheEvictionTargets
}

func newResponseCacheSink(targets responseCacheEvictionTargets) ingest.Sink {
	return responseCacheSink{targets: targets}
}

func (s responseCacheSink) Upsert(row interface{}) { s.UpsertChange(nil, row) }

func (s responseCacheSink) UpsertChange(previous, row interface{}) {
	summary, ok := row.(objectcatalog.Summary)
	if !ok {
		return
	}
	s.evict(summary)
	if prior, ok := previous.(objectcatalog.Summary); ok &&
		snapshot.ResourceVersionUnchanged(prior.ResourceVersion, summary.ResourceVersion) {
		return
	}
	s.ring(summary)
}

func (s responseCacheSink) Delete(row interface{}) {
	summary, ok := row.(objectcatalog.Summary)
	if !ok {
		return
	}
	s.evict(summary)
	s.ring(summary)
}

func (s responseCacheSink) evict(summary objectcatalog.Summary) {
	s.targets.gateway.invalidateResponseCacheForResource(s.targets.selectionKey, summary.Ref)
	if isPodRef(summary.Ref) {
		s.targets.gateway.invalidatePodListingDetails(s.targets.selectionKey, summary.Ref.Namespace)
	}
}

// ring announces what evict dropped: the object's own details and, for a Pod,
// the details of every kind that lists pods in its namespace.
func (s responseCacheSink) ring(summary objectcatalog.Summary) {
	ref := summary.Ref
	s.targets.notifier.ObjectChanged(schema.GroupVersionKind{Group: ref.Group, Version: ref.Version, Kind: ref.Kind}, ref.Namespace, ref.Name)
	if !isPodRef(ref) {
		return
	}
	for _, gvk := range podListingDetailKinds {
		s.targets.notifier.KindChangedInNamespace(gvk, ref.Namespace)
	}
}
