package backend

import (
	"context"
	"fmt"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/internal/errorcapture"
	"github.com/luxury-yacht/app/backend/internal/logsources"
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

// FetchResourceList adapts no-context test list fetches to the production
// retry and error-reporting path. List results are not cached.
func FetchResourceList[T any](
	g *ResourceGateway,
	clusterID string,
	resourceKind string,
	namespace string,
	fetchFunc func() (T, error),
) (T, error) {
	var zero T
	scope := "cluster"
	if namespace != "" {
		scope = fmt.Sprintf("namespace %s", namespace)
	}

	ctx := g.CtxOrBackground()
	if _, hasDeadline := ctx.Deadline(); !hasDeadline {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, config.ResourceFetchCallTimeout)
		defer cancel()
	}

	result, err := executeWithRetry(ctx, g.resourceRetryDependencies(), clusterID, resourceKind, scope, func(context.Context) (T, error) {
		return fetchFunc()
	})
	if err != nil {
		g.logger.Error(fmt.Sprintf("Failed to list %s in %s: %v", resourceKind, scope, err), logsources.ResourceLoader, clusterID, g.clusterNameForID(clusterID))
		g.emitEvent(backendErrorEventName, BackendErrorEvent{
			ClusterID:    clusterID,
			ResourceKind: resourceKind,
			Identifier:   scope,
			Message:      err.Error(),
			Error:        fmt.Sprintf("%v", err),
		})
		return zero, errorcapture.Enhance(err)
	}

	return result, nil
}
