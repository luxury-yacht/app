package objectcatalog

// catalogChange retains the prior identity so recreation removes the old UID
// from query rows and finalizer findings before publishing its replacement.
type catalogChange struct {
	previous *Summary
	next     *Summary
}

// publishCatalogChangesLocked runs with publication ownership (syncMu, then mu).
// Sink registration defers publication until every source has replayed its rows.
func (s *Service) publishCatalogChangesLocked(changes []catalogChange) bool {
	if s.suspendPublication.Load() {
		return false
	}
	if s.queryEngineStore == nil || s.kindCounts == nil {
		s.cacheRebuilds.Add(1)
		s.catalogIndex.rebuildCacheFromItems(s.items, s.catalogIndex.descriptors())
		s.replaceFinalizerBlockers(s.items)
		return true
	}
	for _, change := range changes {
		s.catalogIndex.publishChange(change)
	}
	s.catalogIndex.publishFacetCounts()
	s.cachesReady = true
	s.updateFinalizerBlockers(changes)
	return true
}

func (idx *catalogIndex) publishChange(change catalogChange) {
	if change.previous != nil {
		idx.queryEngineStore.Delete(catalogEngineUID(*change.previous))
		idx.countFacets(*change.previous, -1)
	}
	if change.next != nil {
		idx.queryEngineStore.Upsert(*change.next)
		idx.countFacets(*change.next, 1)
	}
}

func (idx *catalogIndex) countFacets(row Summary, delta int) {
	if row.Ref.Kind != "" {
		adjustCatalogCount(idx.kindCounts, KindInfo{Kind: row.Ref.Kind, Namespaced: row.Scope == ScopeNamespace}, delta)
	}
	if row.Ref.Namespace != "" {
		adjustCatalogCount(idx.namespaceCounts, row.Ref.Namespace, delta)
	}
}

func adjustCatalogCount[K comparable](counts map[K]int, key K, delta int) {
	counts[key] += delta
	if counts[key] <= 0 {
		delete(counts, key)
	}
}

func (idx *catalogIndex) publishFacetCounts() {
	kinds := make(map[string]bool, len(idx.kindCounts))
	for kind := range idx.kindCounts {
		kinds[kind.Kind] = kind.Namespaced
	}
	namespaces := make(map[string]struct{}, len(idx.namespaceCounts))
	for namespace := range idx.namespaceCounts {
		namespaces[namespace] = struct{}{}
	}
	idx.cachedKinds = snapshotSortedKindInfos(kinds)
	idx.cachedNamespaces = snapshotSortedKeys(namespaces)
}
