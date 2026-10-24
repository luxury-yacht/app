package backend

import (
	"sync"

	"k8s.io/apimachinery/pkg/runtime/schema"

	"github.com/luxury-yacht/app/backend/kind/kindregistry"
	"github.com/luxury-yacht/app/backend/objectcatalog"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
	"github.com/luxury-yacht/app/backend/refresh/snapshot"
	"github.com/luxury-yacht/app/backend/refresh/system"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/luxury-yacht/app/backend/resources/configmap"
	"github.com/luxury-yacht/app/backend/resources/helm"
	"github.com/luxury-yacht/app/backend/resources/secret"
)

// responseCacheInvalidator is the gateway's eviction surface. Refresh owns the
// handlers that call it (refresh-system.md: Refresh may invoke gateway
// invalidators; the gateway never calls back into Refresh).
type responseCacheInvalidator interface {
	hasResponseCache() bool
	invalidateResponseCacheForResource(string, resourcemodel.ResourceRef)
	invalidatePodListingDetails(selectionKey, namespace string)
	invalidateHelmCache(selectionKey, namespace, release string)
}

// registerResponseCacheInvalidation wires ingest-driven eviction of cached
// detail/YAML/helm responses onto the subsystem's owned reflectors. Each sink
// evicts through the gateway and then records the change for the
// object-details doorbell, in that order, so a signal-triggered read never
// returns the pre-change copy.
func (a *RefreshCoordinator) registerResponseCacheInvalidation(subsystem *system.Subsystem, selectionKey string) {
	if a == nil || a.resources == nil || !a.resources.hasResponseCache() || subsystem == nil || subsystem.IngestManager == nil {
		return
	}
	targets := responseCacheEvictionTargets{
		gateway:      a.resources,
		notifier:     subsystem.ObjectDetailsNotifier,
		selectionKey: selectionKey,
	}

	// Every built-in kind is fed by its owned reflector; its catalog Summary
	// carries the identity eviction keys off.
	registerIngestResponseCacheInvalidation(subsystem, targets)

	// Helm release details are keyed by release, not by the storage object, so
	// a release's storage Secrets and ConfigMaps evict them from their own sink.
	registerHelmCacheInvalidation(subsystem, targets)

	registerCustomResourceCacheInvalidation(subsystem, targets)
}

// responseCacheEvictionTargets is what every eviction handler acts on: the
// gateway's cache for one cluster, then that cluster's details doorbell.
type responseCacheEvictionTargets struct {
	gateway      responseCacheInvalidator
	notifier     *snapshot.ObjectDetailsChangeNotifier
	selectionKey string
}

func registerIngestResponseCacheInvalidation(subsystem *system.Subsystem, targets responseCacheEvictionTargets) {
	sink := newResponseCacheSink(targets)
	for _, descriptor := range kindregistry.All {
		subsystem.IngestManager.AddCatalogSink(descriptor.Identity.GVR(), sink)
	}
}

func registerCustomResourceCacheInvalidation(subsystem *system.Subsystem, targets responseCacheEvictionTargets) {
	// This is wired before generation startup, so the initial LIST and later
	// mutations invalidate responses before catalog publication and its doorbell.
	subsystem.IngestManager.SetDynamicCatalogSink(newResponseCacheSink(targets))
}

// registerHelmCacheInvalidation adds the Helm cache sink to the Secrets and
// ConfigMaps ingest stores, whose bundles carry each Helm storage object's
// release (helm.StorageRecord).
func registerHelmCacheInvalidation(subsystem *system.Subsystem, targets responseCacheEvictionTargets) {
	sink := newHelmCacheSink(targets)
	for _, gvr := range []schema.GroupVersionResource{secret.Identity.GVR(), configmap.Identity.GVR()} {
		subsystem.IngestManager.AddBundleSink(gvr, sink)
	}
}

// helmCacheSink evicts a Helm release's cached details, manifest, and values
// when one of its storage objects changes, then rings the release's details
// doorbell. It remembers each storage object's resourceVersion, so a relist's
// unchanged objects evict and ring nothing.
type helmCacheSink struct {
	targets responseCacheEvictionTargets
	// mu guards seen: the Secrets and ConfigMaps stores call the sink under
	// their own locks, concurrently.
	mu   sync.Mutex
	seen map[resourcemodel.ResourceRef]string
}

var _ ingest.BundleSeeder = (*helmCacheSink)(nil)

func newHelmCacheSink(targets responseCacheEvictionTargets) *helmCacheSink {
	return &helmCacheSink{targets: targets, seen: make(map[resourcemodel.ResourceRef]string)}
}

func (s *helmCacheSink) UpsertBundle(bundle ingest.Bundle) {
	record, summary, ok := helmStorageChange(bundle)
	if !ok {
		return
	}
	s.mu.Lock()
	unchanged := s.seen[summary.Ref] == summary.ResourceVersion
	s.seen[summary.Ref] = summary.ResourceVersion
	s.mu.Unlock()
	if !unchanged {
		s.evict(record)
	}
}

func (s *helmCacheSink) DeleteBundle(bundle ingest.Bundle) {
	record, summary, ok := helmStorageChange(bundle)
	if !ok {
		return
	}
	s.mu.Lock()
	delete(s.seen, summary.Ref)
	s.mu.Unlock()
	s.evict(record)
}

// SeedBundles remembers the restored storage objects, so a relist after a
// re-warm rings only the ones that changed.
func (s *helmCacheSink) SeedBundles(bundles []ingest.Bundle) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, bundle := range bundles {
		if _, summary, ok := helmStorageChange(bundle); ok {
			s.seen[summary.Ref] = summary.ResourceVersion
		}
	}
}

func (s *helmCacheSink) evict(record helm.StorageRecord) {
	if record.Release == "" {
		return
	}
	s.targets.gateway.invalidateHelmCache(s.targets.selectionKey, record.Namespace, record.Release)
	s.targets.notifier.ObjectChanged(resourcemodel.HelmReleaseGVK, record.Namespace, record.Release)
}

// helmStorageChange is the bundle's Helm storage record and catalog Summary,
// or false for an object that is not Helm storage.
func helmStorageChange(bundle ingest.Bundle) (helm.StorageRecord, objectcatalog.Summary, bool) {
	record, ok := bundle.Aggregate.(helm.StorageRecord)
	summary, hasSummary := bundle.Catalog.(objectcatalog.Summary)
	return record, summary, ok && hasSummary
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
