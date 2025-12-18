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
// additional diagnostic information. The cacheKey parameter is retained for
// compatibility with legacy callers but no longer drives any caching.
func FetchResource[T any](
	a *App,
	_ string,
	resourceKind string,
	identifier string,
	fetchFunc func() (T, error),
) (T, error) {
	var zero T
	ctx := a.CtxOrBackground()
	if _, hasDeadline := ctx.Deadline(); !hasDeadline {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, fetchCallTimeout)
		defer cancel()
	}

	result, err := executeWithRetry(ctx, a, resourceKind, identifier, fetchFunc)
	if err != nil {
		a.logger.Error(fmt.Sprintf("Failed to fetch %s %s: %v", resourceKind, identifier, err), "ResourceLoader")
		a.emitEvent("backend-error", map[string]any{
			"resourceKind": resourceKind,
			"identifier":   identifier,
			"message":      err.Error(),
			"error":        fmt.Sprintf("%v", err),
		})
		return zero, errorcapture.Enhance(err)
	}

	return result, nil
}

// FetchResourceList executes a list fetch function for a given resource kind
// and namespace. No caching is performed; the parameters mirror the legacy
// helper so existing callers can migrate without sweeping changes.
func FetchResourceList[T any](
	a *App,
	_ string,
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

	result, err := executeWithRetry(ctx, a, resourceKind, scope, fetchFunc)
	if err != nil {
		a.logger.Error(fmt.Sprintf("Failed to list %s in %s: %v", resourceKind, scope, err), "ResourceLoader")
		a.emitEvent("backend-error", map[string]any{
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
	resourceKind string,
	namespace, name string,
	fetchFunc func() (T, error),
) (T, error) {
	var zero T
	if err := a.ensureClientInitialized(resourceKind); err != nil {
		return zero, err
	}
	cacheKey := cachekeys.Build(strings.ToLower(resourceKind)+"-detailed", namespace, name)
	identifier := fmt.Sprintf("%s/%s", namespace, name)
	return FetchResource(a, cacheKey, resourceKind, identifier, fetchFunc)
}

// FetchClusterResource handles the common pattern for cluster-scoped resources.
// It wraps client initialization, cache key generation, and FetchResource into one call.
func FetchClusterResource[T any](
	a *App,
	resourceKind string,
	name string,
	fetchFunc func() (T, error),
) (T, error) {
	var zero T
	if err := a.ensureClientInitialized(resourceKind); err != nil {
		return zero, err
	}
	cacheKey := cachekeys.Build(strings.ToLower(resourceKind)+"-detailed", "", name)
	return FetchResource(a, cacheKey, resourceKind, name, fetchFunc)
}

// EnsureClientInitialized checks if the Kubernetes client is initialized
func (a *App) ensureClientInitialized(resourceKind string) error {
	if a.client == nil {
		a.logger.Error(fmt.Sprintf("Kubernetes client not initialized for %s fetch", resourceKind), "ResourceLoader")
		return fmt.Errorf("kubernetes client not initialized")
	}
	return nil
}

// EnsureAPIExtensionsClientInitialized checks if the API extensions client is initialized
func (a *App) ensureAPIExtensionsClientInitialized(resourceKind string) error {
	if a.apiextensionsClient == nil {
		a.logger.Error(fmt.Sprintf("API extensions client not initialized for %s fetch", resourceKind), "ResourceLoader")
		return fmt.Errorf("apiextensions client not initialized")
	}
	return nil
}

// Legacy optional fetch helpers have been removed as part of the domain refactor.

func executeWithRetry[T any](ctx context.Context, a *App, resourceKind, target string, fetchFunc func() (T, error)) (T, error) {
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
				a.recordTransportSuccess()
				a.updateConnectionStatus(ConnectionStateHealthy, "", 0)
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
				a.updateConnectionStatus(ConnectionStateRetrying, fmt.Sprintf("Retrying %s %s: %s", resourceKind, target, reason), backoff)
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
				a.recordTransportFailure(reason, err)
				a.updateConnectionStatus(ConnectionStateOffline, fmt.Sprintf("Failed %s %s: %v", resourceKind, target, err), 0)
			}
		} else if a != nil {
			a.recordTransportSuccess()
			a.updateConnectionStatus(ConnectionStateHealthy, "", 0)
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
