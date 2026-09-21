package objectcatalog

// Querier owns catalog query execution behind the stable QueryOptions
// to QueryResult contract. The default implementation is the current in-memory
// catalog index; alternative stores must preserve cursor, total, facet, and
// identity semantics.
type Querier interface {
	QueryCatalog(opts QueryOptions) (QueryResult, bool)
}

type inMemoryCatalogQueryStore struct {
	service *Service
}

func newInMemoryCatalogQueryStore(service *Service) Querier {
	return inMemoryCatalogQueryStore{service: service}
}

func (store inMemoryCatalogQueryStore) QueryCatalog(opts QueryOptions) (QueryResult, bool) {
	if store.service == nil {
		return QueryResult{}, false
	}
	// Serve through the shared querypage engine (queryViaEngine). It reads the
	// store maintained by full and incremental publication; when no summaries
	// have been published it serves the items-map
	// snapshot on the same engine. Either way it returns a result (ok=true), so
	// the catalog has one query implementation.
	return store.service.queryViaEngine(opts)
}
