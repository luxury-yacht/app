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
	// generation counts evictions. A fetch reads it before starting, and set
	// refuses the result if the entry was evicted after that.
	generation uint64
	// evictedAt and evictedPrefixes record the generation of each key's, and
	// each key prefix's, latest eviction.
	evictedAt       map[string]uint64
	evictedPrefixes map[string]uint64
	// floor is the generation of the last clear or record reset; a fetch that
	// began before it is not stored.
	floor uint64
}

// maxEvictionRecords bounds the eviction records; past it they are dropped and
// every fetch in flight is treated as outdated.
const maxEvictionRecords = 4096

type responseCacheEntry struct {
	value     any
	expiresAt time.Time
}

func newResponseCache(ttl time.Duration, maxEntries int) *responseCache {
	if maxEntries < 0 {
		maxEntries = 0
	}
	return &responseCache{
		ttl:             ttl,
		maxEntries:      maxEntries,
		entries:         make(map[string]responseCacheEntry),
		evictedAt:       make(map[string]uint64),
		evictedPrefixes: make(map[string]uint64),
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

// currentGeneration is read before a fetch; set with it refuses a result that an
// eviction during the fetch made stale.
func (c *responseCache) currentGeneration() uint64 {
	if c == nil {
		return 0
	}
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.generation
}

func (c *responseCache) set(key string, value any, since uint64) {
	if c == nil || c.ttl <= 0 || key == "" {
		return
	}

	c.mu.Lock()
	defer c.mu.Unlock()
	if c.evictedSinceLocked(key, since) {
		return
	}

	if c.maxEntries > 0 && len(c.entries) >= c.maxEntries {
		// Drop all cached entries to keep memory bounded without heavy bookkeeping.
		c.entries = make(map[string]responseCacheEntry)
	}

	c.entries[key] = responseCacheEntry{
		value:     value,
		expiresAt: time.Now().Add(c.ttl),
	}
}

// evictedSinceLocked reports whether key, or a prefix of it, was evicted after
// generation since.
func (c *responseCache) evictedSinceLocked(key string, since uint64) bool {
	if since < c.floor || c.evictedAt[key] > since {
		return true
	}
	for prefix, generation := range c.evictedPrefixes {
		if generation > since && strings.HasPrefix(key, prefix) {
			return true
		}
	}
	return false
}

// recordEvictionLocked advances the generation and records it in records under
// key, dropping every record once there are too many.
func (c *responseCache) recordEvictionLocked(records map[string]uint64, key string) {
	c.generation++
	if len(c.evictedAt)+len(c.evictedPrefixes) >= maxEvictionRecords {
		clear(c.evictedAt)
		clear(c.evictedPrefixes)
		c.floor = c.generation
	}
	records[key] = c.generation
}

func (c *responseCache) delete(key string) {
	if c == nil || key == "" {
		return
	}
	c.mu.Lock()
	c.recordEvictionLocked(c.evictedAt, key)
	delete(c.entries, key)
	c.mu.Unlock()
}

// deletePrefix evicts every key starting with prefix, including results still
// being fetched.
func (c *responseCache) deletePrefix(prefix string) {
	if c == nil || prefix == "" {
		return
	}
	c.mu.Lock()
	c.recordEvictionLocked(c.evictedPrefixes, prefix)
	for key := range c.entries {
		if strings.HasPrefix(key, prefix) {
			delete(c.entries, key)
		}
	}
	c.mu.Unlock()
}

func (c *responseCache) clear() {
	if c == nil {
		return
	}
	c.mu.Lock()
	c.generation++
	c.floor = c.generation
	c.entries = make(map[string]responseCacheEntry)
	clear(c.evictedAt)
	clear(c.evictedPrefixes)
	c.mu.Unlock()
}

// responseCacheKey scopes cache keys by cluster selection to avoid cross-cluster reuse.
func (g *ResourceGateway) responseCacheKey(selectionKey, cacheKey string) string {
	cacheKey = strings.TrimSpace(cacheKey)
	if cacheKey == "" {
		return ""
	}
	if selectionKey == "" {
		return cacheKey
	}
	return selectionKey + "|" + cacheKey
}

func (g *ResourceGateway) responseCacheLookup(selectionKey, cacheKey string) (any, bool) {
	if g == nil || g.responseCache == nil {
		return nil, false
	}
	fullKey := g.responseCacheKey(selectionKey, cacheKey)
	if fullKey == "" {
		return nil, false
	}
	return g.responseCache.get(fullKey)
}

// responseCacheGeneration is read before a fetch whose result is stored with
// responseCacheStore.
func (g *ResourceGateway) responseCacheGeneration() uint64 {
	if g == nil {
		return 0
	}
	return g.responseCache.currentGeneration()
}

// responseCacheStore keeps a fetched value unless its entry was evicted after
// `since`, the generation read before the fetch began.
func (g *ResourceGateway) responseCacheStore(selectionKey, cacheKey string, value any, since uint64) {
	if g == nil || g.responseCache == nil {
		return
	}
	fullKey := g.responseCacheKey(selectionKey, cacheKey)
	if fullKey == "" {
		return
	}
	g.responseCache.set(fullKey, value, since)
}

func (g *ResourceGateway) responseCacheDelete(selectionKey, cacheKey string) {
	if g == nil || g.responseCache == nil {
		return
	}
	fullKey := g.responseCacheKey(selectionKey, cacheKey)
	if fullKey == "" {
		return
	}
	g.responseCache.delete(fullKey)
}

// responseCacheDeletePrefix evicts every entry of the selection whose key starts
// with prefix.
func (g *ResourceGateway) responseCacheDeletePrefix(selectionKey, prefix string) {
	if g == nil || g.responseCache == nil {
		return
	}
	fullPrefix := g.responseCacheKey(selectionKey, prefix)
	if fullPrefix == "" {
		return
	}
	g.responseCache.deletePrefix(fullPrefix)
}
