package backend

import (
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestResponseCacheStoresAndExpires(t *testing.T) {
	cache := newResponseCache(10*time.Millisecond, 0)
	cache.set("key", "value", cache.currentGeneration())

	value, ok := cache.get("key")
	require.True(t, ok)
	require.Equal(t, "value", value)

	time.Sleep(15 * time.Millisecond)
	_, ok = cache.get("key")
	require.False(t, ok)
}

func TestResponseCacheEvictsOnLimit(t *testing.T) {
	cache := newResponseCache(time.Minute, 1)
	cache.set("first", "a", cache.currentGeneration())
	cache.set("second", "b", cache.currentGeneration())

	_, ok := cache.get("first")
	require.False(t, ok)

	value, ok := cache.get("second")
	require.True(t, ok)
	require.Equal(t, "b", value)
}

func TestResponseCacheKeyScopesSelection(t *testing.T) {
	gateway := newResourceGatewayFixture().gateway

	key := gateway.responseCacheKey("config:ctx", "detail::pod")
	require.Equal(t, "config:ctx|detail::pod", key)
}

// A fetch that began before an eviction must not store its stale result, or the
// eviction is undone for another full TTL.
func TestResponseCacheRefusesAResultAnEvictionMadeStale(t *testing.T) {
	cache := newResponseCache(time.Minute, 10)
	since := cache.currentGeneration()
	cache.delete("key")
	cache.set("key", "stale", since)
	_, ok := cache.get("key")
	require.False(t, ok, "a result fetched before the eviction is not kept")

	cache.set("key", "fresh", cache.currentGeneration())
	value, ok := cache.get("key")
	require.True(t, ok)
	require.Equal(t, "fresh", value)

	since = cache.currentGeneration()
	cache.delete("unrelated")
	cache.set("key2", "value", since)
	_, ok = cache.get("key2")
	require.True(t, ok, "evicting another key does not refuse this one")

	since = cache.currentGeneration()
	cache.clear()
	cache.set("key3", "stale", since)
	_, ok = cache.get("key3")
	require.False(t, ok, "clearing the cache outdates fetches in flight")
}

// Past its record limit the cache forgets which keys were evicted; every fetch
// already in flight is then treated as outdated, never as fresh.
func TestResponseCacheTreatsFetchesInFlightAsOutdatedAfterForgettingEvictions(t *testing.T) {
	cache := newResponseCache(time.Minute, 0)
	since := cache.currentGeneration()
	for i := range maxEvictionRecords + 1 {
		cache.delete(fmt.Sprintf("evicted-%d", i))
	}
	cache.set("never-evicted", "outdated", since)
	_, ok := cache.get("never-evicted")
	require.False(t, ok)

	cache.set("never-evicted", "fresh", cache.currentGeneration())
	_, ok = cache.get("never-evicted")
	require.True(t, ok)
}
