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
	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/internal/errorcapture"
	"github.com/luxury-yacht/app/backend/internal/logsources"
	"github.com/luxury-yacht/app/backend/internal/timeutil"
	"github.com/luxury-yacht/app/backend/resources/common"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
)

const (
	connectionRefusedReason = "connection refused"
	connectionResetReason   = "connection reset"
)

type retryTextReason struct {
	token  string
	reason string
}

var (
	urlRetryTextReasons = []retryTextReason{
		{token: connectionRefusedReason, reason: connectionRefusedReason},
		{token: connectionResetReason, reason: connectionResetReason},
		{token: "no such host", reason: "dns lookup failure"},
		{token: "tls", reason: "tls handshake"},
	}
	genericRetryTextReasons = []retryTextReason{
		{token: connectionRefusedReason, reason: connectionRefusedReason},
		{token: connectionResetReason, reason: connectionResetReason},
		{token: "no such host", reason: "no such host"},
		{token: "server misbehaving", reason: "server misbehaving"},
		{token: "i/o timeout", reason: "i/o timeout"},
		{token: "tls handshake", reason: "tls handshake"},
	}
)

var fetchRetrySleep = time.Sleep

// contextSleep allows tests to stub or override; defaults to a context-aware sleep.
var contextSleep = timeutil.SleepWithContext

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
		ctx, cancel = context.WithTimeout(ctx, config.ResourceFetchCallTimeout)
		defer cancel()
	}

	result, err := executeWithRetry(ctx, a, selectionKey, resourceKind, identifier, fetchFunc)
	if err != nil {
		if !errorcapture.IsTelemetryHandled(err) {
			a.logger.ErrorWithCause(err, fmt.Sprintf("Failed to fetch %s %s", resourceKind, identifier), logsources.ResourceLoader, selectionKey, a.clusterNameForID(selectionKey))
		}
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
	if err := requireNamespacedObject(namespace, name); err != nil {
		return zero, err
	}
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
	if err := requireObjectName(name); err != nil {
		return zero, err
	}
	if err := ensureDependenciesInitialized(a, deps, resourceKind); err != nil {
		return zero, err
	}
	cacheKey := cachekeys.Build(strings.ToLower(resourceKind)+"-detailed", "", name)
	return FetchResourceWithSelection(a, selectionKey, cacheKey, resourceKind, name, fetchFunc)
}

// ensureDependenciesInitialized checks the cluster-scoped dependencies before fetching.
func ensureDependenciesInitialized(a *App, deps common.Dependencies, resourceKind string) error {
	if deps.KubernetesClient == nil {
		if deps.Logger != nil {
			deps.Logger.Error(fmt.Sprintf("Kubernetes client not initialized for %s fetch", resourceKind), logsources.ResourceLoader)
		} else if a != nil && a.logger != nil {
			a.logger.Error(fmt.Sprintf("Kubernetes client not initialized for %s fetch", resourceKind), logsources.ResourceLoader, deps.ClusterID, deps.ClusterName)
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

	for attempt := 0; attempt < config.ResourceFetchMaxAttempts; attempt++ {
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
		isLastAttempt := attempt == config.ResourceFetchMaxAttempts-1

		if retryable && !isLastAttempt {
			backoff := config.ResourceFetchRetryBaseDelay << attempt
			if backoff > config.ResourceFetchRetryMaxDelay {
				backoff = config.ResourceFetchRetryMaxDelay
			}
			if a != nil {
				a.logger.Warn(fmt.Sprintf("Retrying %s %s due to %s (attempt %d/%d)", resourceKind, target, reason, attempt+1, config.ResourceFetchMaxAttempts-1), logsources.ResourceLoader, clusterID, a.clusterNameForID(clusterID))
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
	if isNetworkTimeout(err) {
		return true, "network timeout"
	}
	if reason := retryableURLReason(err); reason != "" {
		return true, reason
	}
	if errors.Is(err, io.EOF) {
		return true, "unexpected eof"
	}
	if reason := matchingRetryTextReason(err.Error(), genericRetryTextReasons); reason != "" {
		return true, reason
	}
	if reason := kubernetesRetryReason(err); reason != "" {
		return true, reason
	}
	return false, ""
}

func isNetworkTimeout(err error) bool {
	var netErr net.Error
	return errors.As(err, &netErr) && netErr.Timeout()
}

func retryableURLReason(err error) string {
	var urlErr *url.Error
	if !errors.As(err, &urlErr) || urlErr == nil {
		return ""
	}
	if urlErr.Timeout() {
		return "network timeout"
	}
	if urlErr.Err == nil {
		return ""
	}
	return matchingRetryTextReason(urlErr.Err.Error(), urlRetryTextReasons)
}

func matchingRetryTextReason(message string, reasons []retryTextReason) string {
	lowered := strings.ToLower(message)
	for _, candidate := range reasons {
		if strings.Contains(lowered, candidate.token) {
			return candidate.reason
		}
	}
	return ""
}

func kubernetesRetryReason(err error) string {
	if apierrors.IsTimeout(err) || apierrors.IsServerTimeout(err) {
		return "kubernetes timeout"
	}
	if apierrors.IsTooManyRequests(err) {
		return "rate limited"
	}
	if statusErr, ok := err.(*apierrors.StatusError); ok && statusErr != nil {
		if code := statusErr.ErrStatus.Code; code >= 500 && code < 600 {
			return fmt.Sprintf("apiserver %d", code)
		}
	}
	return ""
}
