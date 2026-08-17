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
	noSuchHostReason        = "no such host"
	tlsHandshakeReason      = "tls handshake"
)

type retryTextReason struct {
	token  string
	reason string
}

var (
	urlRetryTextReasons = []retryTextReason{
		{token: connectionRefusedReason, reason: connectionRefusedReason},
		{token: connectionResetReason, reason: connectionResetReason},
		{token: noSuchHostReason, reason: "dns lookup failure"},
		{token: "tls", reason: tlsHandshakeReason},
	}
	genericRetryTextReasons = []retryTextReason{
		{token: connectionRefusedReason, reason: connectionRefusedReason},
		{token: connectionResetReason, reason: connectionResetReason},
		{token: noSuchHostReason, reason: noSuchHostReason},
		{token: "server misbehaving", reason: "server misbehaving"},
		{token: "i/o timeout", reason: "i/o timeout"},
		{token: tlsHandshakeReason, reason: tlsHandshakeReason},
	}
)

// contextSleep allows tests to stub or override; defaults to a context-aware sleep.
var contextSleep = timeutil.SleepWithContext

type resourceFetchBoundary interface {
	CtxOrBackground() context.Context
	responseCacheLookup(string, string) (any, bool)
	responseCacheStore(string, string, any)
	responseCacheDelete(string, string)
	emitEvent(string, ...interface{})
	resourceRetryDependencies() resourceRetryDependencies
	logResourceFetchError(error, string, string, string)
}

type resourceRetryLogger interface {
	Warn(string, ...string)
}

type resourceRetryDependencies struct {
	recordSuccess func(string)
	recordFailure func(string, string, error)
	telemetry     func() resourceRetryTelemetry
	logger        resourceRetryLogger
	clusterName   func(string) string
}

// FetchResourceWithSelection runs a fetch with a cache key scoped to the provided selection key.
func FetchResourceWithSelection[T any](
	boundary resourceFetchBoundary,
	selectionKey string,
	cacheKey string,
	resourceKind string,
	identifier string,
	fetchFunc func(context.Context) (T, error),
) (T, error) {
	var zero T
	if cached, ok := cachedResource[T](boundary, selectionKey, cacheKey); ok {
		return cached, nil
	}
	ctx, cancel := resourceFetchContext(boundary)
	if cancel != nil {
		defer cancel()
	}

	var retryDependencies resourceRetryDependencies
	if boundary != nil {
		retryDependencies = boundary.resourceRetryDependencies()
	}
	result, err := executeWithRetry(ctx, retryDependencies, selectionKey, resourceKind, identifier, fetchFunc)
	if err != nil {
		if boundary != nil && !errorcapture.IsTelemetryHandled(err) {
			boundary.logResourceFetchError(err, fmt.Sprintf("Failed to fetch %s %s", resourceKind, identifier), selectionKey, "")
		}
		// Include clusterId in error payload so frontend can identify which cluster
		// the error belongs to. selectionKey is the clusterID when set by callers
		// like FetchNamespacedResource and FetchClusterResource.
		if boundary != nil {
			boundary.emitEvent(backendErrorEventName, BackendErrorEvent{
				ClusterID:    selectionKey,
				ResourceKind: resourceKind,
				Identifier:   identifier,
				Message:      err.Error(),
				Error:        fmt.Sprintf("%v", err),
			})
		}
		return zero, errorcapture.Enhance(err)
	}

	if boundary != nil {
		boundary.responseCacheStore(selectionKey, cacheKey, result)
	}
	return result, nil
}

func cachedResource[T any](boundary resourceFetchBoundary, selectionKey, cacheKey string) (T, bool) {
	var zero T
	if boundary == nil {
		return zero, false
	}
	cached, ok := boundary.responseCacheLookup(selectionKey, cacheKey)
	if !ok {
		return zero, false
	}
	typed, ok := cached.(T)
	if !ok {
		// Cached value was the wrong type; evict and refetch.
		boundary.responseCacheDelete(selectionKey, cacheKey)
		return zero, false
	}
	return typed, true
}

func resourceFetchContext(boundary resourceFetchBoundary) (context.Context, context.CancelFunc) {
	ctx := context.Background()
	if boundary != nil {
		ctx = boundary.CtxOrBackground()
	}
	if _, hasDeadline := ctx.Deadline(); hasDeadline {
		return ctx, nil
	}
	return context.WithTimeout(ctx, config.ResourceFetchCallTimeout)
}

// FetchNamespacedResource handles the common pattern for namespace-scoped resources.
// It wraps client initialization, cache key generation, and FetchResource into one call.
func FetchNamespacedResource[T any](
	boundary resourceFetchBoundary,
	deps common.Dependencies,
	selectionKey string,
	resourceKind string,
	namespace, name string,
	fetchFunc func(context.Context) (T, error),
) (T, error) {
	var zero T
	if err := requireNamespacedObject(namespace, name); err != nil {
		return zero, err
	}
	if err := ensureDependenciesInitialized(boundary, deps, resourceKind); err != nil {
		return zero, err
	}
	cacheKey := cachekeys.Build(strings.ToLower(resourceKind)+"-detailed", namespace, name)
	identifier := fmt.Sprintf("%s/%s", namespace, name)
	return FetchResourceWithSelection(boundary, selectionKey, cacheKey, resourceKind, identifier, fetchFunc)
}

// FetchClusterResource handles the common pattern for cluster-scoped resources.
// It wraps client initialization, cache key generation, and FetchResource into one call.
func FetchClusterResource[T any](
	boundary resourceFetchBoundary,
	deps common.Dependencies,
	selectionKey string,
	resourceKind string,
	name string,
	fetchFunc func(context.Context) (T, error),
) (T, error) {
	var zero T
	if err := requireObjectName(name); err != nil {
		return zero, err
	}
	if err := ensureDependenciesInitialized(boundary, deps, resourceKind); err != nil {
		return zero, err
	}
	cacheKey := cachekeys.Build(strings.ToLower(resourceKind)+"-detailed", "", name)
	return FetchResourceWithSelection(boundary, selectionKey, cacheKey, resourceKind, name, fetchFunc)
}

// ensureDependenciesInitialized checks the cluster-scoped dependencies before fetching.
func ensureDependenciesInitialized(boundary resourceFetchBoundary, deps common.Dependencies, resourceKind string) error {
	if deps.KubernetesClient == nil {
		err := fmt.Errorf("kubernetes client not initialized")
		message := fmt.Sprintf("Kubernetes client not initialized for %s fetch", resourceKind)
		if deps.Logger != nil {
			deps.Logger.Error(message, logsources.ResourceLoader)
		} else if boundary != nil {
			boundary.logResourceFetchError(err, message, deps.ClusterID, deps.ClusterName)
		}
		return err
	}
	return nil
}

func executeWithRetry[T any](ctx context.Context, dependencies resourceRetryDependencies, clusterID, resourceKind, target string, fetchFunc func(context.Context) (T, error)) (T, error) {
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
	operation := fetchRetryOperation[T]{
		dependencies: dependencies, clusterID: clusterID, resourceKind: resourceKind, target: target, fetch: fetchFunc,
	}
	return operation.run(ctx)
}

type fetchRetryOperation[T any] struct {
	dependencies resourceRetryDependencies
	clusterID    string
	resourceKind string
	target       string
	fetch        func(context.Context) (T, error)
}

func (o fetchRetryOperation[T]) run(ctx context.Context) (T, error) {
	var zero T
	for attempt := 0; attempt < config.ResourceFetchMaxAttempts; attempt++ {
		if err := ctx.Err(); err != nil {
			return zero, err
		}
		result, err := o.fetch(ctx)
		if err == nil {
			o.recordSuccess(attempt)
			return result, nil
		}
		retryable, reason := isRetryableFetchError(err)
		if retryable && attempt < config.ResourceFetchMaxAttempts-1 {
			if err := o.waitForRetry(ctx, attempt, reason, err); err != nil {
				return zero, err
			}
			continue
		}
		o.recordTerminalError(retryable, reason, err)
		return zero, err
	}
	return zero, fmt.Errorf("exceeded retry attempts for %s %s", o.resourceKind, o.target)
}

func (o fetchRetryOperation[T]) recordSuccess(attempt int) {
	if o.clusterID != "" && o.dependencies.recordSuccess != nil {
		o.dependencies.recordSuccess(o.clusterID)
	}
	if telemetry := o.retryTelemetry(); attempt > 0 && telemetry != nil {
		telemetry.RecordRetrySuccess()
	}
}

func (o fetchRetryOperation[T]) waitForRetry(ctx context.Context, attempt int, reason string, fetchErr error) error {
	backoff := resourceFetchRetryBackoff(attempt)
	o.recordRetryAttempt(attempt, reason, fetchErr)
	return contextSleep(ctx, backoff)
}

func resourceFetchRetryBackoff(attempt int) time.Duration {
	backoff := config.ResourceFetchRetryBaseDelay << attempt
	if backoff > config.ResourceFetchRetryMaxDelay {
		return config.ResourceFetchRetryMaxDelay
	}
	return backoff
}

func (o fetchRetryOperation[T]) recordRetryAttempt(attempt int, reason string, fetchErr error) {
	if o.dependencies.logger != nil {
		clusterName := o.clusterID
		if o.dependencies.clusterName != nil {
			clusterName = o.dependencies.clusterName(o.clusterID)
		}
		o.dependencies.logger.Warn(
			fmt.Sprintf(
				"Retrying %s %s due to %s (attempt %d/%d)",
				o.resourceKind, o.target, reason, attempt+1, config.ResourceFetchMaxAttempts-1,
			),
			logsources.ResourceLoader, o.clusterID, clusterName,
		)
	}
	if telemetry := o.retryTelemetry(); telemetry != nil {
		telemetry.RecordRetryAttempt(fetchErr)
	}
}

func (o fetchRetryOperation[T]) recordTerminalError(retryable bool, reason string, fetchErr error) {
	if !retryable {
		o.recordNonRetryableTransportSuccess()
		return
	}
	if telemetry := o.retryTelemetry(); telemetry != nil {
		telemetry.RecordRetryExhausted(fetchErr)
	}
	if o.clusterID != "" && o.dependencies.recordFailure != nil {
		o.dependencies.recordFailure(o.clusterID, reason, fetchErr)
	}
}

func (o fetchRetryOperation[T]) recordNonRetryableTransportSuccess() {
	if o.clusterID != "" && o.dependencies.recordSuccess != nil {
		o.dependencies.recordSuccess(o.clusterID)
	}
}

func (o fetchRetryOperation[T]) retryTelemetry() resourceRetryTelemetry {
	if o.dependencies.telemetry == nil {
		return nil
	}
	return o.dependencies.telemetry()
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
