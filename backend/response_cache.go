package backend

import (
	"strings"
	"sync"
	"time"

	"github.com/luxury-yacht/app/backend/internal/config"
)

// responseCache stores short-lived GET responses for non-informer endpoints.
type responseCache struct {
	mu         sync.RWMutex
	ttl        time.Duration
	maxEntries int
	entries    map[string]responseCacheEntry
}

type responseCacheEntry struct {
	value     any
	expiresAt time.Time
}

func newResponseCache(ttl time.Duration, maxEntries int) *responseCache {
	if maxEntries < 0 {
		maxEntries = 0
	}
	return &responseCache{
		ttl:        ttl,
		maxEntries: maxEntries,
		entries:    make(map[string]responseCacheEntry),
	}
}

func newDefaultResponseCache() *responseCache {
	return newResponseCache(config.ResponseCacheTTL, config.ResponseCacheMaxEntries)
}

func (c *responseCache) get(key string) (any, bool) {
	if c == nil || c.ttl <= 0 || key == "" {
		return nil, false
	}

	c.mu.RLock()
	entry, ok := c.entries[key]
	c.mu.RUnlock()
	if !ok {
		return nil, false
	}

	if time.Now().After(entry.expiresAt) {
		c.mu.Lock()
		delete(c.entries, key)
		c.mu.Unlock()
		return nil, false
	}

	return entry.value, true
}

func (c *responseCache) set(key string, value any) {
	if c == nil || c.ttl <= 0 || key == "" {
		return
	}

	c.mu.Lock()
	defer c.mu.Unlock()

	if c.maxEntries > 0 && len(c.entries) >= c.maxEntries {
		// Drop all cached entries to keep memory bounded without heavy bookkeeping.
		c.entries = make(map[string]responseCacheEntry)
	}

	c.entries[key] = responseCacheEntry{
		value:     value,
		expiresAt: time.Now().Add(c.ttl),
	}
}

func (c *responseCache) delete(key string) {
	if c == nil || key == "" {
		return
	}
	c.mu.Lock()
	delete(c.entries, key)
	c.mu.Unlock()
}

// responseCacheKey scopes cache keys by cluster selection to avoid cross-cluster reuse.
func (a *App) responseCacheKey(selectionKey, cacheKey string) string {
	cacheKey = strings.TrimSpace(cacheKey)
	if cacheKey == "" {
		return ""
	}
	if selectionKey == "" && a != nil {
		selectionKey = strings.TrimSpace(a.currentSelectionKey())
	}
	if selectionKey == "" {
		return cacheKey
	}
	return selectionKey + "|" + cacheKey
}

func (a *App) responseCacheLookup(selectionKey, cacheKey string) (any, bool) {
	if a == nil || a.responseCache == nil {
		return nil, false
	}
	fullKey := a.responseCacheKey(selectionKey, cacheKey)
	if fullKey == "" {
		return nil, false
	}
	return a.responseCache.get(fullKey)
}

func (a *App) responseCacheStore(selectionKey, cacheKey string, value any) {
	if a == nil || a.responseCache == nil {
		return
	}
	fullKey := a.responseCacheKey(selectionKey, cacheKey)
	if fullKey == "" {
		return
	}
	a.responseCache.set(fullKey, value)
}

func (a *App) responseCacheDelete(selectionKey, cacheKey string) {
	if a == nil || a.responseCache == nil {
		return
	}
	fullKey := a.responseCacheKey(selectionKey, cacheKey)
	if fullKey == "" {
		return
	}
	a.responseCache.delete(fullKey)
}
