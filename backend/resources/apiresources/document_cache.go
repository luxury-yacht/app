package apiresources

import (
	"sync"

	"k8s.io/client-go/openapi"
)

// DocumentCache keeps the most recently used OpenAPI group-version documents so
// a document, which can be megabytes, is downloaded once per version of the
// schema instead of once per explain call. Entries are keyed by the document's
// server URL, which carries a hash of its content, so a cached document can
// never be stale: a changed schema has a new URL.
type DocumentCache struct {
	mu       sync.Mutex
	capacity int
	// entries is ordered least recently used first.
	entries []cachedDocument
}

type cachedDocument struct {
	key      string
	document []byte
}

// NewDocumentCache returns a cache that holds up to capacity documents.
func NewDocumentCache(capacity int) *DocumentCache {
	return &DocumentCache{capacity: max(1, capacity)}
}

// Client wraps delegate so its group-version documents are served from the
// cache. scope separates callers whose documents must never mix (clusters).
// The index is always read from delegate, which is what keeps documents fresh.
func (c *DocumentCache) Client(scope string, delegate openapi.Client) openapi.Client {
	return cachingClient{cache: c, scope: scope, delegate: delegate}
}

func (c *DocumentCache) get(key string) ([]byte, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	for index, entry := range c.entries {
		if entry.key == key {
			// Move to the most recently used end.
			c.entries = append(append(c.entries[:index:index], c.entries[index+1:]...), entry)
			return entry.document, true
		}
	}
	return nil, false
}

func (c *DocumentCache) put(key string, document []byte) {
	c.mu.Lock()
	defer c.mu.Unlock()
	for _, entry := range c.entries {
		if entry.key == key {
			return
		}
	}
	c.entries = append(c.entries, cachedDocument{key: key, document: document})
	if len(c.entries) > c.capacity {
		c.entries = c.entries[len(c.entries)-c.capacity:]
	}
}

type cachingClient struct {
	cache    *DocumentCache
	scope    string
	delegate openapi.Client
}

func (c cachingClient) Paths() (map[string]openapi.GroupVersion, error) {
	paths, err := c.delegate.Paths()
	if err != nil {
		return nil, err
	}
	cached := make(map[string]openapi.GroupVersion, len(paths))
	for path, groupVersion := range paths {
		cached[path] = cachingGroupVersion{GroupVersion: groupVersion, cache: c.cache, scope: c.scope}
	}
	return cached, nil
}

type cachingGroupVersion struct {
	openapi.GroupVersion
	cache *DocumentCache
	scope string
}

func (g cachingGroupVersion) Schema(contentType string) ([]byte, error) {
	key := g.scope + "\x00" + g.ServerRelativeURL() + "\x00" + contentType
	if document, ok := g.cache.get(key); ok {
		return document, nil
	}
	document, err := g.GroupVersion.Schema(contentType)
	if err != nil {
		return nil, err
	}
	g.cache.put(key, document)
	return document, nil
}
