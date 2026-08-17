package backend

import (
	"context"
)

// FetchResource adapts no-context test fetches to the production retry/cache
// path without adding an owner method solely for tests.
func FetchResource[T any](
	g *ResourceGateway,
	cacheKey string,
	resourceKind string,
	identifier string,
	fetchFunc func() (T, error),
) (T, error) {
	return FetchResourceWithSelection(g, "", cacheKey, resourceKind, identifier, func(context.Context) (T, error) {
		return fetchFunc()
	})
}
