package backend

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestResponseCacheStoresAndExpires(t *testing.T) {
	cache := newResponseCache(10*time.Millisecond, 0)
	cache.set("key", "value")

	value, ok := cache.get("key")
	require.True(t, ok)
	require.Equal(t, "value", value)

	time.Sleep(15 * time.Millisecond)
	_, ok = cache.get("key")
	require.False(t, ok)
}

func TestResponseCacheEvictsOnLimit(t *testing.T) {
	cache := newResponseCache(time.Minute, 1)
	cache.set("first", "a")
	cache.set("second", "b")

	_, ok := cache.get("first")
	require.False(t, ok)

	value, ok := cache.get("second")
	require.True(t, ok)
	require.Equal(t, "b", value)
}

func TestResponseCacheKeyScopesSelection(t *testing.T) {
	app := newTestAppWithDefaults(t)
	app.selectedKubeconfig = "/tmp/config"

	key := app.responseCacheKey("", "detail::pod")
	require.Equal(t, "config|detail::pod", key)
}
