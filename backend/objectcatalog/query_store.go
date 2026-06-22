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
	// chunks, so it returns the same result the legacy chunk-scan executor did —
	// proven by the equivalence gate (query_engine_equivalence_test.go). A nil/empty
	// store returns ok=false, so Query falls back to the uncached snapshot path,
	// preserving the prior "no chunks yet" behavior.
	return store.service.queryViaEngine(opts)
}
