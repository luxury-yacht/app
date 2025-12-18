package backend

import (
	"context"
	"errors"
	"io"
	"net"
	"net/url"
	"testing"
	"time"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/runtime/schema"
	kubernetesfake "k8s.io/client-go/kubernetes/fake"

	apiextensionsclientset "k8s.io/apiextensions-apiserver/pkg/client/clientset/clientset"

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

func TestFetchResourceListErrorEmits(t *testing.T) {
	app := newTestAppWithDefaults(t)
	app.Ctx = context.Background()
	var emitted map[string]any
	app.eventEmitter = func(_ context.Context, name string, args ...interface{}) {
		if name == "backend-error" && len(args) > 0 {
			emitted = args[0].(map[string]any)
		}
	}

	_, err := FetchResourceList(app, "cache", "Widget", "default", func() ([]string, error) {
		return nil, errors.New("boom")
	})

	require.Error(t, err)
	require.NotNil(t, emitted)
	require.Equal(t, "Widget", emitted["resourceKind"])
	require.Contains(t, emitted["scope"], "namespace default")
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
	require.Equal(t, fetchMaxAttempts, callCount)
	require.NotNil(t, emitted)

	summary := app.telemetryRecorder.SnapshotSummary()
	require.Equal(t, uint64(fetchMaxAttempts-1), summary.Connection.RetryAttempts)
	require.Equal(t, uint64(0), summary.Connection.RetrySuccesses)
	require.Equal(t, uint64(1), summary.Connection.RetryExhausted)
	require.Equal(t, "Widget", emitted["resourceKind"])
	require.Equal(t, "default/foo", emitted["identifier"])
}

func TestEnsureAPIExtensionsClientInitializedRequiresClient(t *testing.T) {
	app := newTestAppWithDefaults(t)
	app.logger = NewLogger(10)

	err := app.ensureAPIExtensionsClientInitialized("CRD")
	require.Error(t, err)

	entries := app.logger.GetEntries()
	require.NotEmpty(t, entries)
	require.Contains(t, entries[len(entries)-1].Message, "API extensions client not initialized")
}

func TestEnsureAPIExtensionsClientInitializedPassesWhenSet(t *testing.T) {
	app := newTestAppWithDefaults(t)
	app.apiextensionsClient = &apiextensionsclientset.Clientset{}

	err := app.ensureAPIExtensionsClientInitialized("CRD")
	require.NoError(t, err)
}

func TestEnsureClientInitialized(t *testing.T) {
	app := newTestAppWithDefaults(t)
	app.logger = NewLogger(5)

	err := app.ensureClientInitialized("Pod")
	require.Error(t, err)
	require.Contains(t, app.logger.GetEntries()[0].Message, "not initialized")

	app.client = kubernetesfake.NewSimpleClientset()
	require.NoError(t, app.ensureClientInitialized("Pod"))
}

func TestIsRetryableFetchErrorVariants(t *testing.T) {
	tests := []struct {
		name      string
		err       error
		retryable bool
	}{
		{"deadline", context.DeadlineExceeded, true},
		{"net timeout", &net.DNSError{IsTimeout: true}, true},
		{"url tls", &url.Error{Err: errors.New("tls handshake"), Op: "GET", URL: "https://x"}, true},
		{"io eof", io.EOF, true},
		{"api status 500", apierrors.NewGenericServerResponse(500, "get", schema.GroupResource{}, "x", "boom", 0, false), true},
		{"too many requests", apierrors.NewTooManyRequests("busy", 0), true},
		{"non retryable", errors.New("bad"), false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, _ := isRetryableFetchError(tt.err)
			require.Equal(t, tt.retryable, got)
		})
	}
}
