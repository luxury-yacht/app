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
	app := newTestAppWithDefaults(t)
	var emitted map[string]any
	app.Ctx = context.Background()
	app.eventEmitter = func(_ context.Context, name string, args ...interface{}) {
		if name == "backend-error" && len(args) > 0 {
			if payload, ok := args[0].(map[string]any); ok {
				emitted = payload
			}
		}
	}

	value, err := FetchResource(app, "cacheKey", "Widget", "default/foo", func() (string, error) {
		return "", errors.New("boom")
	})

	require.Empty(t, value)
	require.Error(t, err)
	require.NotNil(t, emitted)
	require.Equal(t, "", emitted["clusterId"])
	require.Equal(t, "Widget", emitted["resourceKind"])
	require.Equal(t, "default/foo", emitted["identifier"])
}

func TestFetchResourceSuccess(t *testing.T) {
	app := newTestAppWithDefaults(t)
	called := false
	app.eventEmitter = func(context.Context, string, ...interface{}) {
		called = true
	}

	value, err := FetchResource(app, "cache", "Widget", "id", func() (string, error) {
		return "hello", nil
	})

	require.NoError(t, err)
	require.Equal(t, "hello", value)
	require.False(t, called)
}

func TestFetchResourceUsesCache(t *testing.T) {
	app := newTestAppWithDefaults(t)
	app.responseCache = newResponseCache(time.Minute, 10)
	callCount := 0

	value, err := FetchResource(app, "cache-key", "Widget", "id", func() (string, error) {
		callCount++
		return "cached", nil
	})
	require.NoError(t, err)
	require.Equal(t, "cached", value)

	value, err = FetchResource(app, "cache-key", "Widget", "id", func() (string, error) {
		callCount++
		return "fresh", nil
	})
	require.NoError(t, err)
	require.Equal(t, "cached", value)
	require.Equal(t, 1, callCount)
}

func TestFetchResourceSkipsCacheWhenKeyEmpty(t *testing.T) {
	app := newTestAppWithDefaults(t)
	app.responseCache = newResponseCache(time.Minute, 10)
	callCount := 0

	_, err := FetchResource(app, "", "Widget", "id", func() (string, error) {
		callCount++
		return "first", nil
	})
	require.NoError(t, err)

	_, err = FetchResource(app, "", "Widget", "id", func() (string, error) {
		callCount++
		return "second", nil
	})
	require.NoError(t, err)
	require.Equal(t, 2, callCount)
}

func TestFetchResourceListErrorEmits(t *testing.T) {
	app := newTestAppWithDefaults(t)
	app.Ctx = context.Background()
	var emitted map[string]any
	app.eventEmitter = func(_ context.Context, name string, args ...interface{}) {
		if name == "backend-error" && len(args) > 0 {
			emitted = args[0].(map[string]any)
		}
	}

	_, err := FetchResourceList(app, "test-cluster", "Widget", "default", func() ([]string, error) {
		return nil, errors.New("boom")
	})

	require.Error(t, err)
	require.NotNil(t, emitted)
	require.Equal(t, "test-cluster", emitted["clusterId"])
	require.Equal(t, "Widget", emitted["resourceKind"])
	require.Contains(t, emitted["scope"], "namespace default")
}

func TestFetchNamespacedResourceRequiresObjectIdentity(t *testing.T) {
	app := newTestAppWithDefaults(t)

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
			_, err := FetchNamespacedResource(app, common.Dependencies{}, "cluster-1", "Widget", tt.namespace, tt.object, func() (string, error) {
				called = true
				return "unexpected", nil
			})

			require.ErrorContains(t, err, tt.wantErr)
			require.False(t, called)
		})
	}
}

func TestFetchClusterResourceRequiresObjectName(t *testing.T) {
	app := newTestAppWithDefaults(t)

	for _, name := range []string{"", "  "} {
		t.Run("name="+name, func(t *testing.T) {
			called := false
			_, err := FetchClusterResource(app, common.Dependencies{}, "cluster-1", "Widget", name, func() (string, error) {
				called = true
				return "unexpected", nil
			})

			require.ErrorContains(t, err, "name is required")
			require.False(t, called)
		})
	}
}

func TestFetchResourceRetriesOnTransientError(t *testing.T) {
	app := newTestAppWithDefaults(t)
	app.telemetryRecorder = telemetry.NewRecorder()
	app.logger = NewLogger(100)
	app.Ctx = context.Background()

	originalSleep := fetchRetrySleep
	fetchRetrySleep = func(time.Duration) {}
	t.Cleanup(func() { fetchRetrySleep = originalSleep })

	callCount := 0
	value, err := FetchResource(app, "", "Widget", "default/foo", func() (string, error) {
		callCount++
		if callCount == 1 {
			return "", &url.Error{Err: errors.New("connection refused"), Op: "GET", URL: "https://cluster"}
		}
		return "ok", nil
	})

	require.NoError(t, err)
	require.Equal(t, "ok", value)
	require.Equal(t, 2, callCount)

	summary := app.telemetryRecorder.SnapshotSummary()
	require.Equal(t, uint64(1), summary.Connection.RetryAttempts)
	require.Equal(t, uint64(1), summary.Connection.RetrySuccesses)
	require.Equal(t, uint64(0), summary.Connection.RetryExhausted)
}

func TestFetchResourceExhaustsRetriesAndEmits(t *testing.T) {
	app := newTestAppWithDefaults(t)
	app.telemetryRecorder = telemetry.NewRecorder()
	app.logger = NewLogger(100)
	app.Ctx = context.Background()
	var emitted map[string]any
	app.eventEmitter = func(_ context.Context, name string, args ...interface{}) {
		if name == "backend-error" && len(args) > 0 {
			emitted = args[0].(map[string]any)
		}
	}

	originalSleep := fetchRetrySleep
	fetchRetrySleep = func(time.Duration) {}
	t.Cleanup(func() { fetchRetrySleep = originalSleep })

	callCount := 0
	value, err := FetchResource(app, "", "Widget", "default/foo", func() (string, error) {
		callCount++
		return "", &url.Error{Err: errors.New("connection refused"), Op: "GET", URL: "https://cluster"}
	})

	require.Zero(t, value)
	require.Error(t, err)
	require.Equal(t, config.ResourceFetchMaxAttempts, callCount)
	require.NotNil(t, emitted)

	summary := app.telemetryRecorder.SnapshotSummary()
	require.Equal(t, uint64(config.ResourceFetchMaxAttempts-1), summary.Connection.RetryAttempts)
	require.Equal(t, uint64(0), summary.Connection.RetrySuccesses)
	require.Equal(t, uint64(1), summary.Connection.RetryExhausted)
	require.Equal(t, "", emitted["clusterId"])
	require.Equal(t, "Widget", emitted["resourceKind"])
	require.Equal(t, "default/foo", emitted["identifier"])
}

func TestExecuteWithRetryValidatesInputs(t *testing.T) {
	_, err := executeWithRetry[string](context.Background(), nil, "", "Widget", "", nil)
	require.ErrorContains(t, err, "fetch function not provided")

	value, err := executeWithRetry[string](context.Background(), nil, "", "Widget", "", func() (string, error) {
		return "ok", nil
	})
	require.NoError(t, err)
	require.Equal(t, "ok", value)
}

func TestExecuteWithRetryWithoutAppUsesConfiguredSleep(t *testing.T) {
	originalSleep := fetchRetrySleep
	var delays []time.Duration
	fetchRetrySleep = func(delay time.Duration) { delays = append(delays, delay) }
	t.Cleanup(func() { fetchRetrySleep = originalSleep })

	attempts := 0
	value, err := executeWithRetry(context.Background(), nil, "cluster-a", "Widget", "demo", func() (string, error) {
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

func TestExecuteWithRetryReturnsContextSleepFailure(t *testing.T) {
	app := newTestAppWithDefaults(t)
	sleepErr := errors.New("sleep interrupted")
	originalSleep := contextSleep
	contextSleep = func(context.Context, time.Duration) error { return sleepErr }
	t.Cleanup(func() { contextSleep = originalSleep })

	_, err := executeWithRetry(context.Background(), app, "cluster-a", "Widget", "demo", func() (string, error) {
		return "", io.EOF
	})
	require.ErrorIs(t, err, sleepErr)
}

func TestExecuteWithRetryDoesNotRetryPermanentErrorWithoutApp(t *testing.T) {
	attempts := 0
	permanent := errors.New("validation failed")
	_, err := executeWithRetry(context.Background(), nil, "cluster-a", "Widget", "demo", func() (string, error) {
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
