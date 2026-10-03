package backend

// seedResponseCache stores a value as a fetch that began now would, so tests can
// arrange cached responses.
func (g *ResourceGateway) seedResponseCache(selectionKey, cacheKey string, value any) {
	g.responseCacheStore(selectionKey, cacheKey, value, g.responseCacheGeneration())
}
