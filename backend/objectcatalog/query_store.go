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
	// Serve through the shared querypage engine (queryViaEngine). It reads the
	// maintained store that publishStreamingState keeps equal to the published
	// summaries; when no summaries have been published it serves the items-map
	// snapshot on the same engine. Either way it returns a result (ok=true), so
	// the catalog has one query implementation.
	return store.service.queryViaEngine(opts)
}
