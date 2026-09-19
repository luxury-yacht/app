package snapshot

import (
	"context"
	"maps"
	"sort"
	"strconv"
	"strings"

	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/permissions"
)

type resourceReadinessContextKey struct{}

// withResourceReadiness attaches one immutable per-build readiness snapshot.
// The service captures it after the settlement gate so every builder in the
// singleflight observes the same data-availability truth.
func withResourceReadiness(ctx context.Context, states map[string]refresh.ResourceReadiness) context.Context {
	if len(states) == 0 {
		return ctx
	}
	return context.WithValue(ctx, resourceReadinessContextKey{}, maps.Clone(states))
}

func resourceReadinessFromContext(ctx context.Context, key string) refresh.ResourceReadiness {
	states, _ := ctx.Value(resourceReadinessContextKey{}).(map[string]refresh.ResourceReadiness)
	return states[key]
}

func resourceReadinessFor(ctx context.Context, group, resource string) refresh.ResourceReadiness {
	return resourceReadinessFromContext(ctx, permissions.ResourceKey(group, resource))
}

// resourceReadinessFingerprint keeps readiness changes outside stale cache and
// singleflight identities. Sorting makes the result independent of map order.
func resourceReadinessFingerprint(states map[string]refresh.ResourceReadiness) string {
	if len(states) == 0 {
		return ""
	}
	keys := make([]string, 0, len(states))
	for key := range states {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(keys))
	for _, key := range keys {
		parts = append(parts, key+"="+strconv.Itoa(int(states[key])))
	}
	return checksumBytes([]byte(strings.Join(parts, ";")))
}
