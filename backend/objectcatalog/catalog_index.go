/*
 * backend/objectcatalog/catalog_index.go
 *
 * Owns the in-memory indexes used by the object catalog service.
 */

package objectcatalog

import (
	"sort"
	"strings"
	"time"

	"github.com/luxury-yacht/app/backend/refresh/querypage"
)

type catalogIndex struct {
	items     map[string]Summary
	lastSeen  map[string]time.Time
	resources map[string]resourceDescriptor

	exact map[catalogObjectIdentity]string
	uid   map[string]string

	// cachedKinds/cachedNamespaces/cachedDescriptors are the publish-time facet lists
	// the engine serve reads for the no-filter and namespace-filter facet cases.
	cachedKinds       []KindInfo
	cachedNamespaces  []string
	cachedDescriptors []Descriptor
	cachesReady       bool

	// queryEngineStore is the shared querypage engine view of the catalog. It is the
	// authoritative query state: rebuilt wholesale from the published summaries in
	// publishStreamingState and maintained for Browse/object-catalog queries via
	// queryViaEngine. (Named distinctly from the Service.queryStore CatalogQueryStore
	// to avoid an embedded-field ambiguity.)
	queryEngineStore *querypage.Store[Summary]

	lastFirstBatchLatency time.Duration
}

type catalogObjectIdentity struct {
	namespace string
	group     string
	version   string
	kind      string
	name      string
}

func newCatalogIndex() catalogIndex {
	return catalogIndex{
		items:     make(map[string]Summary),
		lastSeen:  make(map[string]time.Time),
		resources: make(map[string]resourceDescriptor),
		exact:     make(map[catalogObjectIdentity]string),
		uid:       make(map[string]string),
	}
}

func (idx *catalogIndex) reset() {
	*idx = newCatalogIndex()
	idx.cachesReady = true
	// A reset catalog serves an empty engine view, not a nil one, so a query after a
	// "no resources discovered" sync returns an empty page rather than rebuilding an
	// ephemeral store from the (also empty) items snapshot.
	idx.queryEngineStore = querypage.NewStore(newCatalogQueryStoreSchema())
}

// rebuildQueryStore replaces the maintained querypage store with one holding exactly
// the items in the published chunks. A wholesale rebuild here keeps the engine view
// equal to the published summary set at every publish. The store is keyed by the
// catalog identity chain (schema UID), which is unique per published summary, so no
// chunk item is dropped.
func (idx *catalogIndex) rebuildQueryStore(chunks []*summaryChunk) {
	store := querypage.NewStore(newCatalogQueryStoreSchema())
	for _, chunk := range chunks {
		if chunk == nil {
			continue
		}
		for _, item := range chunk.items {
			store.Upsert(item)
		}
	}
	idx.queryEngineStore = store
}

// resetQueryStore replaces the maintained query store with a fresh empty one. The sync
// pipeline calls it once at sync start (before the parallel collectors emit) so a resync's
// progressive streaming view holds only the in-progress sync's data — matching the previous
// per-emit wholesale rebuild's "this sync only" semantics, but without the O(N²) cost.
func (idx *catalogIndex) resetQueryStore() {
	idx.queryEngineStore = querypage.NewStore(newCatalogQueryStoreSchema())
}

// appendStreamingChunk publishes one streaming chunk by upserting its items into the
// maintained query store and refreshing the published facet snapshots. It maintains the
// store INCREMENTALLY — O(chunk) per call — instead of rebuilding it from every chunk
// emitted so far. Emits run once per (kind,namespace) batch across a sync, so a wholesale
// rebuild per emit was O(N²) in total rows (the namespace-list hang). The store's UID is the
// unique catalog identity chain, so incremental upserts produce the same store a wholesale
// rebuild would. cachesReady stays false until finalize/rebuildCacheFromItems flips it.
func (idx *catalogIndex) appendStreamingChunk(items []Summary, kindSet map[string]bool, namespaceSet map[string]struct{}) {
	if idx.queryEngineStore == nil {
		idx.queryEngineStore = querypage.NewStore(newCatalogQueryStoreSchema())
	}
	for _, item := range items {
		idx.queryEngineStore.Upsert(item)
	}
	idx.cachedKinds = snapshotSortedKindInfos(kindSet)
	idx.cachedNamespaces = snapshotSortedKeys(namespaceSet)
	idx.cachesReady = false
}

func (idx *catalogIndex) snapshot() []Summary {
	result := make([]Summary, 0, len(idx.items))
	for _, item := range idx.items {
		result = append(result, item)
	}
	return result
}

func (idx *catalogIndex) count() int {
	return len(idx.items)
}

func (idx *catalogIndex) descriptorCount() int {
	return len(idx.resources)
}

func (idx *catalogIndex) descriptors() []Descriptor {
	result := make([]Descriptor, 0, len(idx.resources))
	for _, desc := range idx.resources {
		result = append(result, exportDescriptor(desc))
	}
	sortDescriptors(result)
	return result
}

func (idx *catalogIndex) namespaces() []string {
	cached := append([]string(nil), idx.cachedNamespaces...)
	if len(cached) > 0 {
		return cached
	}
	if len(idx.items) == 0 {
		return nil
	}
	namespaceSet := make(map[string]struct{})
	for _, summary := range idx.items {
		if summary.Namespace != "" {
			namespaceSet[summary.Namespace] = struct{}{}
		}
	}
	return snapshotSortedKeys(namespaceSet)
}

func (idx *catalogIndex) replaceResources(resources map[string]resourceDescriptor) {
	idx.resources = cloneResourceDescriptorMap(resources)
}

func (idx *catalogIndex) setResource(gvr string, desc resourceDescriptor) {
	if idx.resources == nil {
		idx.resources = make(map[string]resourceDescriptor)
	}
	idx.resources[gvr] = desc
}

func (idx *catalogIndex) resource(gvr string) (resourceDescriptor, bool) {
	desc, ok := idx.resources[gvr]
	return desc, ok
}

func (idx *catalogIndex) resourceForGroupResource(group, resource string) (string, *resourceDescriptor) {
	for gvr, desc := range idx.resources {
		if desc.Group == group && desc.Resource == resource {
			copy := desc
			return gvr, &copy
		}
	}
	return "", nil
}

func (idx *catalogIndex) cachesAreReady() bool {
	return idx.cachesReady
}

func (idx *catalogIndex) findExact(namespace, group, version, kind, name string) (Summary, bool) {
	if idx.exact == nil || (len(idx.exact) == 0 && len(idx.items) > 0) {
		idx.rebuildLookupIndexes()
	}
	key := catalogObjectIdentity{
		namespace: normalizeLookupNamespace(namespace),
		group:     strings.TrimSpace(group),
		version:   strings.TrimSpace(version),
		kind:      strings.TrimSpace(kind),
		name:      strings.TrimSpace(name),
	}
	itemKey, ok := idx.exact[key]
	if !ok {
		return Summary{}, false
	}
	item, ok := idx.items[itemKey]
	return item, ok
}

func (idx *catalogIndex) findUID(uid string) (Summary, bool) {
	normalizedUID := strings.TrimSpace(uid)
	if normalizedUID == "" {
		return Summary{}, false
	}
	if idx.uid == nil || (len(idx.uid) == 0 && len(idx.items) > 0) {
		idx.rebuildLookupIndexes()
	}
	itemKey, ok := idx.uid[normalizedUID]
	if !ok {
		return Summary{}, false
	}
	item, ok := idx.items[itemKey]
	return item, ok
}

func (idx *catalogIndex) setItem(key string, summary Summary, seen time.Time) {
	if idx.items == nil {
		idx.items = make(map[string]Summary)
	}
	if idx.lastSeen == nil {
		idx.lastSeen = make(map[string]time.Time)
	}
	idx.items[key] = summary
	idx.lastSeen[key] = seen
	idx.indexItem(key, summary)
}

func (idx *catalogIndex) deleteItem(key string) bool {
	if _, exists := idx.items[key]; !exists {
		return false
	}
	delete(idx.items, key)
	delete(idx.lastSeen, key)
	idx.rebuildLookupIndexes()
	return true
}

func (idx *catalogIndex) publishStreamingState(
	chunks []*summaryChunk,
	kindSet map[string]bool,
	namespaceSet map[string]struct{},
	descriptors []Descriptor,
	ready bool,
) {
	chunkSnapshot := make([]*summaryChunk, len(chunks))
	copy(chunkSnapshot, chunks)
	idx.rebuildQueryStore(chunkSnapshot)
	idx.cachedKinds = snapshotSortedKindInfos(kindSet)
	idx.cachedNamespaces = snapshotSortedKeys(namespaceSet)
	if descriptors != nil {
		idx.cachedDescriptors = append([]Descriptor(nil), descriptors...)
	}
	idx.cachesReady = ready
}

// catalogQueryNamespaceIndexKey is the namespace facet representation: "cluster" for
// cluster-scoped or empty-namespace rows, else the lowercased namespace. The engine
// schema's namespace facet and the namespace filter keys agree on this representation.
func catalogQueryNamespaceIndexKey(namespace string, scope Scope) string {
	if scope == ScopeCluster || namespace == "" {
		return "cluster"
	}
	return strings.ToLower(strings.TrimSpace(namespace))
}

func (idx *catalogIndex) rebuildCacheFromItems(items map[string]Summary, descriptors []Descriptor) {
	kindSet := make(map[string]bool)
	namespaceSet := make(map[string]struct{})
	chunks := make([]*summaryChunk, 0, 1)

	if len(items) > 0 {
		summaries := make([]Summary, 0, len(items))
		for _, summary := range items {
			summaries = append(summaries, summary)
			if summary.Kind != "" {
				kindSet[summary.Kind] = summary.Scope == ScopeNamespace
			}
			if summary.Namespace != "" {
				namespaceSet[summary.Namespace] = struct{}{}
			}
		}
		chunks = append(chunks, &summaryChunk{items: summaries})
	}

	idx.publishStreamingState(chunks, kindSet, namespaceSet, descriptors, true)
	idx.rebuildLookupIndexes()
}

func (idx *catalogIndex) setFirstBatchLatency(latency time.Duration) {
	idx.lastFirstBatchLatency = latency
}

func (idx *catalogIndex) firstBatchLatency() time.Duration {
	return idx.lastFirstBatchLatency
}

func (idx *catalogIndex) rebuildLookupIndexes() {
	exact := make(map[catalogObjectIdentity]string, len(idx.items))
	uid := make(map[string]string, len(idx.items))
	for key, item := range idx.items {
		exact[catalogIdentityForSummary(item)] = key
		if item.UID != "" {
			uid[item.UID] = key
		}
	}
	idx.exact = exact
	idx.uid = uid
}

func (idx *catalogIndex) indexItem(key string, item Summary) {
	if idx.exact == nil {
		idx.exact = make(map[catalogObjectIdentity]string)
	}
	if idx.uid == nil {
		idx.uid = make(map[string]string)
	}
	idx.exact[catalogIdentityForSummary(item)] = key
	if item.UID != "" {
		idx.uid[item.UID] = key
	}
}

func catalogIdentityForSummary(item Summary) catalogObjectIdentity {
	return catalogObjectIdentity{
		namespace: normalizeLookupNamespace(item.Namespace),
		group:     strings.TrimSpace(item.Group),
		version:   strings.TrimSpace(item.Version),
		kind:      strings.TrimSpace(item.Kind),
		name:      strings.TrimSpace(item.Name),
	}
}

func sortDescriptors(result []Descriptor) {
	sort.Slice(result, func(i, j int) bool {
		if result[i].Group != result[j].Group {
			return result[i].Group < result[j].Group
		}
		if result[i].Version != result[j].Version {
			return result[i].Version < result[j].Version
		}
		if result[i].Resource != result[j].Resource {
			return result[i].Resource < result[j].Resource
		}
		return result[i].Kind < result[j].Kind
	})
}

func cloneResourceDescriptorMap(source map[string]resourceDescriptor) map[string]resourceDescriptor {
	if len(source) == 0 {
		return make(map[string]resourceDescriptor)
	}
	result := make(map[string]resourceDescriptor, len(source))
	for key, value := range source {
		result[key] = value
	}
	return result
}
