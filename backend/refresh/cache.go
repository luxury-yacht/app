package refresh

import "context"

type cacheBypassKey struct{}

// WithCacheBypass marks a snapshot request as uncached (used for manual refreshes).
func WithCacheBypass(ctx context.Context) context.Context {
	if ctx == nil {
		return context.WithValue(context.Background(), cacheBypassKey{}, true)
	}
	return context.WithValue(ctx, cacheBypassKey{}, true)
}

// HasCacheBypass checks whether a snapshot request should bypass caching.
func HasCacheBypass(ctx context.Context) bool {
	if ctx == nil {
		return false
	}
	value := ctx.Value(cacheBypassKey{})
	return value == true
}
