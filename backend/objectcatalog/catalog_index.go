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

	sortedChunks      []*summaryChunk
	chunksNeedSort    bool
	cachedKinds       []KindInfo
	cachedNamespaces  []string
	cachedDescriptors []Descriptor
	queryIndex        catalogQueryIndex
	queryIndexBuilt   bool
	cachesReady       bool

	// queryEngineStore is the shared querypage engine view of the catalog. It is
	// rebuilt wholesale from the published chunks in publishStreamingState, so its
	// rows always equal the chunk-scan executor's candidate set, and queryViaEngine
	// serves byte-identically to the legacy chunk path. (Named distinctly from the
	// Service.queryStore CatalogQueryStore to avoid an embedded-field ambiguity.)
	queryEngineStore *querypage.Store[Summary]

	lastFirstBatchLatency time.Duration
}

type catalogIndexedSummaryRef struct {
	chunk int
	item  int
}

type catalogQueryIndex struct {
	byNamespace        map[string][]catalogIndexedSummaryRef
	byKind             map[string][]catalogIndexedSummaryRef
	byNamespaceAndKind map[string][]catalogIndexedSummaryRef
	kindsByNamespace   map[string]map[string]bool
}

type catalogCachedQueryState struct {
	chunks      []*summaryChunk
	kinds       []KindInfo
	namespaces  []string
	descriptors []Descriptor
	queryIndex  catalogQueryIndex
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
	// A reset catalog serves an empty engine view, not a nil one, so a query
	// after a "no resources discovered" sync returns an empty page (not a fall
	// back to the slow uncached path).
	idx.queryEngineStore = querypage.NewStore(newCatalogQueryStoreSchema())
}

// rebuildQueryStore replaces the maintained querypage store with one holding exactly
// the items in the published chunks. The chunks are the authoritative query state
// (the legacy executor scans them), so a wholesale rebuild here keeps the engine view
// equal to the chunk-scan candidate set at every publish. The store is keyed by the
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

// ensureQueryIndex sorts the chunks (when a watch-flush rebuild deferred it)
// and builds the query index on demand. Publishes only invalidate, so the cost
// is paid at most once per data change — and only when a catalog consumer
// actually queries (never while Browse/Custom views are closed). Callers must
// hold the service write lock.
func (idx *catalogIndex) ensureQueryIndex() {
	if idx.chunksNeedSort {
		sorted := make([]*summaryChunk, len(idx.sortedChunks))
		for i, chunk := range idx.sortedChunks {
			items := append([]Summary(nil), chunk.items...)
			sortSummaries(items)
			sorted[i] = &summaryChunk{items: items}
		}
		idx.sortedChunks = sorted
		idx.chunksNeedSort = false
	}
	if idx.queryIndexBuilt {
		return
	}
	idx.queryIndex = buildCatalogQueryIndex(idx.sortedChunks)
	idx.queryIndexBuilt = true
}

func (idx *catalogIndex) cachedQueryState() catalogCachedQueryState {
	chunks := make([]*summaryChunk, len(idx.sortedChunks))
	copy(chunks, idx.sortedChunks)
	return catalogCachedQueryState{
		chunks:     chunks,
		kinds:      append([]KindInfo(nil), idx.cachedKinds...),
		namespaces: append([]string(nil), idx.cachedNamespaces...),
		// Chunks are immutable once published and the query index is replaced
		// wholesale on rebuild (never mutated in place), so the maps are shared
		// with the executor instead of deep-copied per query.
		descriptors: append([]Descriptor(nil), idx.cachedDescriptors...),
		queryIndex:  idx.queryIndex,
	}
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
	idx.sortedChunks = chunkSnapshot
	idx.chunksNeedSort = false
	idx.rebuildQueryStore(chunkSnapshot)
	idx.cachedKinds = snapshotSortedKindInfos(kindSet)
	idx.cachedNamespaces = snapshotSortedKeys(namespaceSet)
	// Invalidate the query index instead of rebuilding it: initial sync
	// publishes once per emitted batch and watch flushes publish every 200ms
	// under churn — rebuilding here made that quadratic across a sync and
	// charged full re-index cost even with no catalog consumer open. The index
	// is built lazily in ensureQueryIndex when a query needs it.
	idx.queryIndex = catalogQueryIndex{}
	idx.queryIndexBuilt = false
	if descriptors != nil {
		idx.cachedDescriptors = append([]Descriptor(nil), descriptors...)
	}
	idx.cachesReady = ready
}

func buildCatalogQueryIndex(chunks []*summaryChunk) catalogQueryIndex {
	index := catalogQueryIndex{
		byNamespace:        make(map[string][]catalogIndexedSummaryRef),
		byKind:             make(map[string][]catalogIndexedSummaryRef),
		byNamespaceAndKind: make(map[string][]catalogIndexedSummaryRef),
		kindsByNamespace:   make(map[string]map[string]bool),
	}
	for chunkIdx, chunk := range chunks {
		if chunk == nil {
			continue
		}
		for itemIdx, item := range chunk.items {
			ref := catalogIndexedSummaryRef{chunk: chunkIdx, item: itemIdx}
			namespaceKey := catalogQueryNamespaceIndexKey(item.Namespace, item.Scope)
			index.byNamespace[namespaceKey] = append(index.byNamespace[namespaceKey], ref)
			if item.Kind != "" {
				kinds := index.kindsByNamespace[namespaceKey]
				if kinds == nil {
					kinds = make(map[string]bool)
					index.kindsByNamespace[namespaceKey] = kinds
				}
				kinds[item.Kind] = item.Scope == ScopeNamespace
			}
			for _, kindKey := range catalogQueryKindIndexKeys(item) {
				index.byKind[kindKey] = append(index.byKind[kindKey], ref)
				compound := catalogQueryCompoundIndexKey(namespaceKey, kindKey)
				index.byNamespaceAndKind[compound] = append(index.byNamespaceAndKind[compound], ref)
			}
		}
	}
	return index
}

func catalogQueryNamespaceIndexKey(namespace string, scope Scope) string {
	if scope == ScopeCluster || namespace == "" {
		return "cluster"
	}
	return strings.ToLower(strings.TrimSpace(namespace))
}

func catalogQueryCompoundIndexKey(namespace, kind string) string {
	return namespace + "\x00" + kind
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
	// Sorting all N items per watch flush (200ms under churn) is deferred to
	// the first query, alongside the index build (ensureQueryIndex).
	idx.chunksNeedSort = true
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
