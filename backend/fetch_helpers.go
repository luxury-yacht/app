package backend

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/url"
	"strings"
	"time"

	"github.com/luxury-yacht/app/backend/internal/cachekeys"
	"github.com/luxury-yacht/app/backend/internal/errorcapture"
	"github.com/luxury-yacht/app/backend/internal/timeutil"
	"github.com/luxury-yacht/app/backend/resources/common"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
)

const (
	fetchMaxAttempts    = 3
	fetchRetryBaseDelay = 250 * time.Millisecond
	fetchRetryMaxDelay  = 2 * time.Second
	fetchCallTimeout    = 30 * time.Second
)

var fetchRetrySleep = time.Sleep

// contextSleep allows tests to stub or override; defaults to a context-aware sleep.
var contextSleep = timeutil.SleepWithContext

// FetchResource executes the supplied fetch function, wrapping any error with
// additional diagnostic information. It uses a short-lived response cache for
// non-informer GETs to avoid repeated requests for the same resource.
func FetchResource[T any](
	a *App,
	cacheKey string,
	resourceKind string,
	identifier string,
	fetchFunc func() (T, error),
) (T, error) {
	return FetchResourceWithSelection(a, "", cacheKey, resourceKind, identifier, fetchFunc)
}

// FetchResourceWithSelection runs a fetch with a cache key scoped to the provided selection key.
func FetchResourceWithSelection[T any](
	a *App,
	selectionKey string,
	cacheKey string,
	resourceKind string,
	identifier string,
	fetchFunc func() (T, error),
) (T, error) {
	var zero T
	if a != nil {
		if cached, ok := a.responseCacheLookup(selectionKey, cacheKey); ok {
			if typed, ok := cached.(T); ok {
				return typed, nil
			}
			// Cached value was the wrong type; evict and refetch.
			a.responseCacheDelete(selectionKey, cacheKey)
		}
	}
	ctx := a.CtxOrBackground()
	if _, hasDeadline := ctx.Deadline(); !hasDeadline {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, fetchCallTimeout)
		defer cancel()
	}

	result, err := executeWithRetry(ctx, a, selectionKey, resourceKind, identifier, fetchFunc)
	if err != nil {
		a.logger.Error(fmt.Sprintf("Failed to fetch %s %s: %v", resourceKind, identifier, err), "ResourceLoader")
		// Include clusterId in error payload so frontend can identify which cluster
		// the error belongs to. selectionKey is the clusterID when set by callers
		// like FetchNamespacedResource and FetchClusterResource.
		a.emitEvent("backend-error", map[string]any{
			"clusterId":    selectionKey,
			"resourceKind": resourceKind,
			"identifier":   identifier,
			"message":      err.Error(),
			"error":        fmt.Sprintf("%v", err),
		})
		return zero, errorcapture.Enhance(err)
	}

	if a != nil {
		a.responseCacheStore(selectionKey, cacheKey, result)
	}
	return result, nil
}

// FetchResourceList executes a list fetch function for a given resource kind
// and namespace. No caching is performed.
func FetchResourceList[T any](
	a *App,
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

	ctx := a.CtxOrBackground()
	if _, hasDeadline := ctx.Deadline(); !hasDeadline {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, fetchCallTimeout)
		defer cancel()
	}

	result, err := executeWithRetry(ctx, a, clusterID, resourceKind, scope, fetchFunc)
	if err != nil {
		a.logger.Error(fmt.Sprintf("Failed to list %s in %s: %v", resourceKind, scope, err), "ResourceLoader")
		// Include clusterId in error payload so frontend can identify which cluster
		// the error belongs to.
		a.emitEvent("backend-error", map[string]any{
			"clusterId":    clusterID,
			"resourceKind": resourceKind,
			"scope":        scope,
			"message":      err.Error(),
			"error":        fmt.Sprintf("%v", err),
		})
		return zero, errorcapture.Enhance(err)
	}

	return result, nil
}

// FetchNamespacedResource handles the common pattern for namespace-scoped resources.
// It wraps client initialization, cache key generation, and FetchResource into one call.
func FetchNamespacedResource[T any](
	a *App,
	deps common.Dependencies,
	selectionKey string,
	resourceKind string,
	namespace, name string,
	fetchFunc func() (T, error),
) (T, error) {
	var zero T
	if err := ensureDependenciesInitialized(a, deps, resourceKind); err != nil {
		return zero, err
	}
	cacheKey := cachekeys.Build(strings.ToLower(resourceKind)+"-detailed", namespace, name)
	identifier := fmt.Sprintf("%s/%s", namespace, name)
	return FetchResourceWithSelection(a, selectionKey, cacheKey, resourceKind, identifier, fetchFunc)
}

// FetchClusterResource handles the common pattern for cluster-scoped resources.
// It wraps client initialization, cache key generation, and FetchResource into one call.
func FetchClusterResource[T any](
	a *App,
	deps common.Dependencies,
	selectionKey string,
	resourceKind string,
	name string,
	fetchFunc func() (T, error),
) (T, error) {
	var zero T
	if err := ensureDependenciesInitialized(a, deps, resourceKind); err != nil {
		return zero, err
	}
	cacheKey := cachekeys.Build(strings.ToLower(resourceKind)+"-detailed", "", name)
	return FetchResourceWithSelection(a, selectionKey, cacheKey, resourceKind, name, fetchFunc)
}

// ensureDependenciesInitialized checks the cluster-scoped dependencies before fetching.
func ensureDependenciesInitialized(a *App, deps common.Dependencies, resourceKind string) error {
	if deps.KubernetesClient == nil {
		if a != nil && a.logger != nil {
			a.logger.Error(fmt.Sprintf("Kubernetes client not initialized for %s fetch", resourceKind), "ResourceLoader")
		}
		return fmt.Errorf("kubernetes client not initialized")
	}
	return nil
}

func executeWithRetry[T any](ctx context.Context, a *App, clusterID, resourceKind, target string, fetchFunc func() (T, error)) (T, error) {
	var zero T
	if ctx == nil {
		ctx = context.Background()
	}
	if fetchFunc == nil {
		return zero, fmt.Errorf("fetch function not provided")
	}
	if target == "" {
		target = "cluster scope"
	}

	for attempt := 0; attempt < fetchMaxAttempts; attempt++ {
		if err := ctx.Err(); err != nil {
			return zero, err
		}

		result, err := fetchFunc()
		if err == nil {
			if a != nil {
				// Record per-cluster transport success if clusterID is provided
				if clusterID != "" {
					a.recordClusterTransportSuccess(clusterID)
				}
				if attempt > 0 && a.telemetryRecorder != nil {
					a.telemetryRecorder.RecordRetrySuccess()
				}
			}
			return result, nil
		}

		retryable, reason := isRetryableFetchError(err)
		isLastAttempt := attempt == fetchMaxAttempts-1

		if retryable && !isLastAttempt {
			backoff := fetchRetryBaseDelay << attempt
			if backoff > fetchRetryMaxDelay {
				backoff = fetchRetryMaxDelay
			}
			if a != nil {
				if a.logger != nil {
					a.logger.Warn(fmt.Sprintf("Retrying %s %s due to %s (attempt %d/%d)", resourceKind, target, reason, attempt+1, fetchMaxAttempts-1), "ResourceLoader")
				}
				if a.telemetryRecorder != nil {
					a.telemetryRecorder.RecordRetryAttempt(err)
				}
			}
			if a == nil {
				fetchRetrySleep(backoff)
				continue
			}
			if err := contextSleep(ctx, backoff); err != nil {
				return zero, err
			}
			continue
		}

		if retryable {
			if a != nil {
				if a.telemetryRecorder != nil {
					a.telemetryRecorder.RecordRetryExhausted(err)
				}
				// Record per-cluster transport failure if clusterID is provided
				if clusterID != "" {
					a.recordClusterTransportFailure(clusterID, reason, err)
				}
			}
		} else if a != nil {
			// Record per-cluster transport success if clusterID is provided
			if clusterID != "" {
				a.recordClusterTransportSuccess(clusterID)
			}
		}

		return zero, err
	}

	return zero, fmt.Errorf("exceeded retry attempts for %s %s", resourceKind, target)
}

func isRetryableFetchError(err error) (bool, string) {
	if err == nil {
		return false, ""
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return true, "request timeout"
	}

	var netErr net.Error
	if errors.As(err, &netErr) {
		if netErr.Timeout() {
			return true, "network timeout"
		}
	}

	var urlErr *url.Error
	if errors.As(err, &urlErr) && urlErr != nil {
		if urlErr.Timeout() {
			return true, "network timeout"
		}
		if urlErr.Err != nil {
			lowered := strings.ToLower(urlErr.Err.Error())
			if strings.Contains(lowered, "connection refused") {
				return true, "connection refused"
			}
			if strings.Contains(lowered, "connection reset") {
				return true, "connection reset"
			}
			if strings.Contains(lowered, "no such host") {
				return true, "dns lookup failure"
			}
			if strings.Contains(lowered, "tls") {
				return true, "tls handshake"
			}
		}
	}

	if errors.Is(err, io.EOF) {
		return true, "unexpected eof"
	}

	lowered := strings.ToLower(err.Error())
	for _, token := range []string{"connection refused", "connection reset", "no such host", "server misbehaving", "i/o timeout", "tls handshake"} {
		if strings.Contains(lowered, token) {
			return true, token
		}
	}

	if apierrors.IsTimeout(err) || apierrors.IsServerTimeout(err) {
		return true, "kubernetes timeout"
	}
	if apierrors.IsTooManyRequests(err) {
		return true, "rate limited"
	}
	if statusErr, ok := err.(*apierrors.StatusError); ok && statusErr != nil {
		if code := statusErr.ErrStatus.Code; code >= 500 && code < 600 {
			return true, fmt.Sprintf("apiserver %d", code)
		}
	}

	return false, ""
}
