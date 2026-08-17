package backend

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/url"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/resources/common"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/runtime/schema"

	"github.com/luxury-yacht/app/backend/refresh/telemetry"
	"github.com/stretchr/testify/require"
)

func TestFetchResourceErrorEmits(t *testing.T) {
	fixture := newResourceGatewayFixture()
	gateway := fixture.gateway
	var emitted *BackendErrorEvent
	fixture.emitEvent = func(name string, args ...interface{}) {
		if name == "backend-error" && len(args) > 0 {
			if payload, ok := args[0].(BackendErrorEvent); ok {
				emitted = &payload
			}
		}
	}

	value, err := FetchResource(gateway, "cacheKey", "Widget", "default/foo", func() (string, error) {
		return "", errors.New("boom")
	})

	require.Empty(t, value)
	require.Error(t, err)
	require.NotNil(t, emitted)
	require.Empty(t, emitted.ClusterID)
	require.Equal(t, "Widget", emitted.ResourceKind)
	require.Equal(t, "default/foo", emitted.Identifier)
}

func TestFetchResourceSuccess(t *testing.T) {
	fixture := newResourceGatewayFixture()
	gateway := fixture.gateway
	called := false
	fixture.emitEvent = func(string, ...interface{}) {
		called = true
	}

	value, err := FetchResource(gateway, "cache", "Widget", "id", func() (string, error) {
		return "hello", nil
	})

	require.NoError(t, err)
	require.Equal(t, "hello", value)
	require.False(t, called)
}

func TestFetchResourceUsesCache(t *testing.T) {
	fixture := newResourceGatewayFixture()
	gateway := fixture.gateway
	gateway.responseCache = newResponseCache(time.Minute, 10)
	callCount := 0

	value, err := FetchResource(gateway, "cache-key", "Widget", "id", func() (string, error) {
		callCount++
		return "cached", nil
	})
	require.NoError(t, err)
	require.Equal(t, "cached", value)

	value, err = FetchResource(gateway, "cache-key", "Widget", "id", func() (string, error) {
		callCount++
		return "fresh", nil
	})
	require.NoError(t, err)
	require.Equal(t, "cached", value)
	require.Equal(t, 1, callCount)
}

func TestFetchResourceSkipsCacheWhenKeyEmpty(t *testing.T) {
	fixture := newResourceGatewayFixture()
	gateway := fixture.gateway
	gateway.responseCache = newResponseCache(time.Minute, 10)
	callCount := 0

	_, err := FetchResource(gateway, "", "Widget", "id", func() (string, error) {
		callCount++
		return "first", nil
	})
	require.NoError(t, err)

	_, err = FetchResource(gateway, "", "Widget", "id", func() (string, error) {
		callCount++
		return "second", nil
	})
	require.NoError(t, err)
	require.Equal(t, 2, callCount)
}

func TestFetchNamespacedResourceRequiresObjectIdentity(t *testing.T) {
	fixture := newResourceGatewayFixture()
	gateway := fixture.gateway

	tests := []struct {
		name      string
		namespace string
		object    string
		wantErr   string
	}{
		{name: "missing namespace", namespace: "", object: "demo", wantErr: "namespace is required"},
		{name: "blank namespace", namespace: "  ", object: "demo", wantErr: "namespace is required"},
		{name: "missing name", namespace: "default", object: "", wantErr: "name is required"},
		{name: "blank name", namespace: "default", object: "  ", wantErr: "name is required"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			called := false
			_, err := FetchNamespacedResource(gateway, common.Dependencies{}, "cluster-1", "Widget", tt.namespace, tt.object, func(context.Context) (string, error) {
				called = true
				return "unexpected", nil
			})

			require.ErrorContains(t, err, tt.wantErr)
			require.False(t, called)
		})
	}
}

func TestFetchClusterResourceRequiresObjectName(t *testing.T) {
	fixture := newResourceGatewayFixture()
	gateway := fixture.gateway

	for _, name := range []string{"", "  "} {
		t.Run("name="+name, func(t *testing.T) {
			called := false
			_, err := FetchClusterResource(gateway, common.Dependencies{}, "cluster-1", "Widget", name, func(context.Context) (string, error) {
				called = true
				return "unexpected", nil
			})

			require.ErrorContains(t, err, "name is required")
			require.False(t, called)
		})
	}
}

func TestFetchResourceRetriesOnTransientError(t *testing.T) {
	fixture := newResourceGatewayFixture()
	gateway := fixture.gateway
	fixture.setTelemetryRecorder(telemetry.NewRecorder())

	originalSleep := contextSleep
	contextSleep = func(context.Context, time.Duration) error { return nil }
	t.Cleanup(func() { contextSleep = originalSleep })

	callCount := 0
	value, err := FetchResource(gateway, "", "Widget", "default/foo", func() (string, error) {
		callCount++
		if callCount == 1 {
			return "", &url.Error{Err: errors.New("connection refused"), Op: "GET", URL: "https://cluster"}
		}
		return "ok", nil
	})

	require.NoError(t, err)
	require.Equal(t, "ok", value)
	require.Equal(t, 2, callCount)

	summary := fixture.telemetry.SnapshotSummary()
	require.Equal(t, uint64(1), summary.Connection.RetryAttempts)
	require.Equal(t, uint64(1), summary.Connection.RetrySuccesses)
	require.Equal(t, uint64(0), summary.Connection.RetryExhausted)
}

func TestFetchResourceExhaustsRetriesAndEmits(t *testing.T) {
	fixture := newResourceGatewayFixture()
	gateway := fixture.gateway
	fixture.setTelemetryRecorder(telemetry.NewRecorder())
	var emitted *BackendErrorEvent
	fixture.emitEvent = func(name string, args ...interface{}) {
		if name == "backend-error" && len(args) > 0 {
			payload := args[0].(BackendErrorEvent)
			emitted = &payload
		}
	}

	originalSleep := contextSleep
	contextSleep = func(context.Context, time.Duration) error { return nil }
	t.Cleanup(func() { contextSleep = originalSleep })

	callCount := 0
	value, err := FetchResource(gateway, "", "Widget", "default/foo", func() (string, error) {
		callCount++
		return "", &url.Error{Err: errors.New("connection refused"), Op: "GET", URL: "https://cluster"}
	})

	require.Zero(t, value)
	require.Error(t, err)
	require.Equal(t, config.ResourceFetchMaxAttempts, callCount)
	require.NotNil(t, emitted)

	summary := fixture.telemetry.SnapshotSummary()
	require.Equal(t, uint64(config.ResourceFetchMaxAttempts-1), summary.Connection.RetryAttempts)
	require.Equal(t, uint64(0), summary.Connection.RetrySuccesses)
	require.Equal(t, uint64(1), summary.Connection.RetryExhausted)
	require.Empty(t, emitted.ClusterID)
	require.Equal(t, "Widget", emitted.ResourceKind)
	require.Equal(t, "default/foo", emitted.Identifier)
}

func TestExecuteWithRetryValidatesInputs(t *testing.T) {
	_, err := executeWithRetry[string](context.Background(), resourceRetryDependencies{}, "", "Widget", "", nil)
	require.ErrorContains(t, err, "fetch function not provided")

	value, err := executeWithRetry[string](context.Background(), resourceRetryDependencies{}, "", "Widget", "", func(context.Context) (string, error) {
		return "ok", nil
	})
	require.NoError(t, err)
	require.Equal(t, "ok", value)
}

func TestExecuteWithRetryWithoutOptionalCallbacksUsesConfiguredSleep(t *testing.T) {
	originalSleep := contextSleep
	var delays []time.Duration
	contextSleep = func(_ context.Context, delay time.Duration) error {
		delays = append(delays, delay)
		return nil
	}
	t.Cleanup(func() { contextSleep = originalSleep })

	attempts := 0
	value, err := executeWithRetry(context.Background(), resourceRetryDependencies{}, "cluster-a", "Widget", "demo", func(context.Context) (string, error) {
		attempts++
		if attempts == 1 {
			return "", io.EOF
		}
		return "ok", nil
	})

	require.NoError(t, err)
	require.Equal(t, "ok", value)
	require.Equal(t, []time.Duration{config.ResourceFetchRetryBaseDelay}, delays)
}

func TestExecuteWithRetryWithoutLoggerUsesContextSleepAndRecordsTelemetry(t *testing.T) {
	recorder := telemetry.NewRecorder()
	sleepErr := errors.New("sleep interrupted")
	originalContextSleep := contextSleep
	contextSleep = func(context.Context, time.Duration) error { return sleepErr }
	t.Cleanup(func() { contextSleep = originalContextSleep })

	_, err := executeWithRetry(
		context.Background(),
		resourceRetryDependencies{telemetry: func() resourceRetryTelemetry { return recorder }},
		"cluster-a",
		"Widget",
		"demo",
		func(context.Context) (string, error) { return "", io.EOF },
	)

	require.ErrorIs(t, err, sleepErr)
	require.Equal(t, uint64(1), recorder.SnapshotSummary().Connection.RetryAttempts)
}

func TestDependencyInitializationFallsBackToGatewayLogger(t *testing.T) {
	fixture := newResourceGatewayFixture()
	deps := common.Dependencies{ClusterID: "cluster-a", ClusterName: "Cluster A"}

	_, err := FetchClusterResource(
		fixture.gateway,
		deps,
		"cluster-a",
		"Widget",
		"demo",
		func(context.Context) (string, error) { return "unexpected", nil },
	)

	require.ErrorContains(t, err, "kubernetes client not initialized")
	entries := fixture.logger.GetEntries()
	require.Len(t, entries, 1)
	require.Contains(t, entries[0].Message, "Kubernetes client not initialized for Widget fetch")
	require.Equal(t, "cluster-a", entries[0].ClusterID)
	require.Equal(t, "Cluster A", entries[0].ClusterName)
}

func TestExecuteWithRetryReturnsContextSleepFailure(t *testing.T) {
	fixture := newResourceGatewayFixture()
	gateway := fixture.gateway
	sleepErr := errors.New("sleep interrupted")
	originalSleep := contextSleep
	contextSleep = func(context.Context, time.Duration) error { return sleepErr }
	t.Cleanup(func() { contextSleep = originalSleep })

	_, err := executeWithRetry(context.Background(), gateway.resourceRetryDependencies(), "cluster-a", "Widget", "demo", func(context.Context) (string, error) {
		return "", io.EOF
	})
	require.ErrorIs(t, err, sleepErr)
}

func TestFetchResourcePropagatesConfiguredDeadline(t *testing.T) {
	fixture := newResourceGatewayFixture()
	gateway := fixture.gateway
	startedAt := time.Now()
	_, err := FetchResourceWithSelection(gateway, "cluster-a", "", "Widget", "demo", func(ctx context.Context) (string, error) {
		deadline, ok := ctx.Deadline()
		require.True(t, ok)
		require.WithinDuration(t, startedAt.Add(config.ResourceFetchCallTimeout), deadline, time.Second)
		return "ok", nil
	})

	require.NoError(t, err)
}

func TestExecuteWithRetryAbortsSlowFetcherAtDeadline(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()

	startedAt := time.Now()
	_, err := executeWithRetry(ctx, resourceRetryDependencies{}, "cluster-a", "Widget", "demo", func(fetchCtx context.Context) (string, error) {
		<-fetchCtx.Done()
		return "", fetchCtx.Err()
	})

	require.ErrorIs(t, err, context.DeadlineExceeded)
	require.Less(t, time.Since(startedAt), time.Second)
}

func TestExecuteWithRetryWithoutOptionalCallbacksDoesNotRetryPermanentError(t *testing.T) {
	attempts := 0
	permanent := errors.New("validation failed")
	_, err := executeWithRetry(context.Background(), resourceRetryDependencies{}, "cluster-a", "Widget", "demo", func(context.Context) (string, error) {
		attempts++
		return "", permanent
	})

	require.ErrorIs(t, err, permanent)
	require.Equal(t, 1, attempts)
}

func TestResourceFetchRetryBackoffCapsAtConfiguredMaximum(t *testing.T) {
	require.Equal(t, config.ResourceFetchRetryMaxDelay, resourceFetchRetryBackoff(30))
}

// Tests for ensureClientInitialized and ensureAPIExtensionsClientInitialized have been removed.
// These helper functions were deleted as part of removing global client fields.
// Client initialization checks are now done via ensureDependenciesInitialized which
// takes explicit Dependencies and does not rely on App-level global fields.

func TestIsRetryableFetchErrorVariants(t *testing.T) {
	tests := []struct {
		name      string
		err       error
		retryable bool
		reason    string
	}{
		{name: "nil", err: nil},
		{name: "deadline", err: context.DeadlineExceeded, retryable: true, reason: "request timeout"},
		{name: "wrapped deadline", err: fmt.Errorf("fetch: %w", context.DeadlineExceeded), retryable: true, reason: "request timeout"},
		{name: "canceled", err: context.Canceled},
		{name: "net timeout", err: &net.DNSError{IsTimeout: true}, retryable: true, reason: "network timeout"},
		{name: "url timeout", err: &url.Error{Err: &net.DNSError{IsTimeout: true}, Op: "GET", URL: "https://x"}, retryable: true, reason: "network timeout"},
		{name: "url connection refused", err: &url.Error{Err: errors.New("dial tcp: connection refused"), Op: "GET", URL: "https://x"}, retryable: true, reason: connectionRefusedReason},
		{name: "url connection reset", err: &url.Error{Err: errors.New("read: connection reset by peer"), Op: "GET", URL: "https://x"}, retryable: true, reason: connectionResetReason},
		{name: "url dns", err: &url.Error{Err: errors.New("lookup x: no such host"), Op: "GET", URL: "https://x"}, retryable: true, reason: "dns lookup failure"},
		{name: "url tls", err: &url.Error{Err: errors.New("remote error: tls handshake failure"), Op: "GET", URL: "https://x"}, retryable: true, reason: "tls handshake"},
		{name: "io eof", err: io.EOF, retryable: true, reason: "unexpected eof"},
		{name: "wrapped io eof", err: fmt.Errorf("decode: %w", io.EOF), retryable: true, reason: "unexpected eof"},
		{name: "plain connection refused", err: errors.New("dial tcp: connection refused"), retryable: true, reason: connectionRefusedReason},
		{name: "plain connection reset", err: errors.New("read: connection reset by peer"), retryable: true, reason: connectionResetReason},
		{name: "plain dns", err: errors.New("lookup x: no such host"), retryable: true, reason: "no such host"},
		{name: "plain dns server", err: errors.New("lookup x: server misbehaving"), retryable: true, reason: "server misbehaving"},
		{name: "plain io timeout", err: errors.New("read: i/o timeout"), retryable: true, reason: "i/o timeout"},
		{name: "plain tls", err: errors.New("remote error: tls handshake failure"), retryable: true, reason: "tls handshake"},
		{name: "kubernetes timeout", err: apierrors.NewTimeoutError("slow", 1), retryable: true, reason: "kubernetes timeout"},
		{name: "kubernetes server timeout", err: apierrors.NewServerTimeout(schema.GroupResource{Resource: "pods"}, "list", 1), retryable: true, reason: "kubernetes timeout"},
		{name: "api status 500", err: apierrors.NewGenericServerResponse(500, "get", schema.GroupResource{}, "x", "boom", 0, false), retryable: true, reason: "apiserver 500"},
		{name: "api status 503", err: apierrors.NewGenericServerResponse(503, "get", schema.GroupResource{}, "x", "boom", 0, false), retryable: true, reason: "apiserver 503"},
		{name: "too many requests", err: apierrors.NewTooManyRequests("busy", 0), retryable: true, reason: "rate limited"},
		{name: "unauthorized", err: apierrors.NewUnauthorized("login")},
		{name: "forbidden", err: apierrors.NewForbidden(schema.GroupResource{Resource: "pods"}, "x", errors.New("denied"))},
		{name: "not found", err: apierrors.NewNotFound(schema.GroupResource{Resource: "pods"}, "x")},
		{name: "non retryable", err: errors.New("bad")},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, reason := isRetryableFetchError(tt.err)
			require.Equal(t, tt.retryable, got)
			require.Equal(t, tt.reason, reason)
		})
	}
}

func TestRetryableURLReasonHandlesEveryURLShape(t *testing.T) {
	require.Empty(t, retryableURLReason(errors.New("not a URL error")))
	require.Equal(t, "network timeout", retryableURLReason(&url.Error{
		Err: &net.DNSError{IsTimeout: true},
		Op:  "GET",
		URL: "https://x",
	}))
	require.Empty(t, retryableURLReason(&url.Error{Op: "GET", URL: "https://x"}))
}
