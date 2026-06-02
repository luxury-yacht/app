package objectcatalog

// CatalogQueryStore owns catalog query execution behind the stable QueryOptions
// to QueryResult contract. The default implementation is the current in-memory
// catalog index; alternative stores must preserve cursor, total, facet, and
// identity semantics.
type CatalogQueryStore interface {
	QueryCatalog(opts QueryOptions) (QueryResult, bool)
}

type inMemoryCatalogQueryStore struct {
	service *Service
}

func newInMemoryCatalogQueryStore(service *Service) CatalogQueryStore {
	return inMemoryCatalogQueryStore{service: service}
}

func (store inMemoryCatalogQueryStore) QueryCatalog(opts QueryOptions) (QueryResult, bool) {
	if store.service == nil {
		return QueryResult{}, false
	}
	kindMatcher := newKindMatcher(opts.Kinds)
	namespaceMatcher := newNamespaceMatcher(opts.Namespaces)
	searchMatcher := newSearchMatcher(opts.Search)

	store.service.mu.RLock()
	cachedState := store.service.catalogIndex.cachedQueryState()
	store.service.mu.RUnlock()

	if len(cachedState.chunks) == 0 {
		return QueryResult{}, false
	}

	executor := store.service.newCatalogQueryExecutor(opts, cachedState, kindMatcher, namespaceMatcher, searchMatcher)
	return executor.executeCached(), true
}
