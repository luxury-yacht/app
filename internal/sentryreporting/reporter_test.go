package sentryreporting

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/getsentry/sentry-go"
	"github.com/stretchr/testify/require"
)

type recordingTransport struct {
	mu      sync.Mutex
	options sentry.ClientOptions
	events  []*sentry.Event
	flushed bool
	closed  bool
}

func (t *recordingTransport) Configure(options sentry.ClientOptions) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.options = options
}

func (t *recordingTransport) SendEvent(event *sentry.Event) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.events = append(t.events, event)
}

func (t *recordingTransport) Flush(time.Duration) bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.flushed = true
	return true
}

func (t *recordingTransport) FlushWithContext(context.Context) bool {
	return t.Flush(0)
}

func (t *recordingTransport) Close() {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.closed = true
}

func (t *recordingTransport) lastEvent() *sentry.Event {
	t.mu.Lock()
	defer t.mu.Unlock()
	if len(t.events) == 0 {
		return nil
	}
	return t.events[len(t.events)-1]
}

func (t *recordingTransport) eventCount() int {
	t.mu.Lock()
	defer t.mu.Unlock()
	return len(t.events)
}

func TestNewReturnsDisabledReporterWithoutDSN(t *testing.T) {
	reporter, err := New(Config{})

	require.NoError(t, err)
	require.False(t, reporter.Enabled())
}

func TestControlledReporterStartsDisabledAndStopsWithoutFlushing(t *testing.T) {
	transport := &recordingTransport{}
	reporter, err := NewDisabled(Config{
		DSN:       "https://public@example.com/1",
		Transport: transport,
	})
	require.NoError(t, err)
	require.False(t, reporter.Enabled())

	reporter.CaptureMessage("secret before opt in", Context{ClusterID: "cluster-a"})
	require.Zero(t, transport.eventCount())

	require.NoError(t, reporter.SetEnabled(true))
	require.True(t, reporter.Enabled())
	reporter.CaptureMessage("secret after opt in", Context{ClusterID: "cluster-a"})
	require.Equal(t, 1, transport.eventCount())

	require.NoError(t, reporter.SetEnabled(false))
	require.False(t, reporter.Enabled())
	reporter.CaptureMessage("secret after opt out", Context{ClusterID: "cluster-a"})
	require.Equal(t, 1, transport.eventCount())

	transport.mu.Lock()
	defer transport.mu.Unlock()
	require.True(t, transport.closed)
	require.False(t, transport.flushed)
}

func TestReporterCapturesAnonymizedMessageWithoutClusterContext(t *testing.T) {
	transport := &recordingTransport{}
	reporter, err := New(Config{
		DSN:         "https://public@example.com/1",
		Environment: "production",
		Release:     "luxury-yacht@v1.2.3",
		Transport:   transport,
	})
	require.NoError(t, err)
	require.True(t, reporter.Enabled())

	reporter.CaptureMessage("refresh subsystem failed", Context{
		Source:    "Refresh",
		ClusterID: "cluster-a",
	})

	event := transport.lastEvent()
	require.NotNil(t, event)
	require.Equal(t, "Backend error", event.Message)
	require.Equal(t, "production", event.Environment)
	require.Equal(t, "luxury-yacht@v1.2.3", event.Release)
	require.Equal(t, "backend", event.Tags["app.surface"])
	require.NotContains(t, event.Tags, "source")
	require.NotContains(t, event.Tags, "clusterId")
}

func TestSanitizeEventRemovesIdentifyingDataAndKeepsDiagnosticStack(t *testing.T) {
	event := &sentry.Event{
		Message:     "refresh failed for customer@example.com",
		Environment: "production",
		Release:     "luxury-yacht@v1.2.3",
		Level:       sentry.LevelError,
		Platform:    "go",
		ServerName:  "alice-workstation",
		Transaction: "customer-cluster-operation",
		Logger:      "private-logger",
		Tags: map[string]string{
			"app.surface": "backend",
			"source":      "Refresh",
			"clusterId":   "customer-kubeconfig:production",
		},
		Contexts: map[string]sentry.Context{
			"customer": {"email": "customer@example.com"},
		},
		User: sentry.User{
			Email:     "customer@example.com",
			IPAddress: "192.0.2.10",
		},
		Request: &sentry.Request{URL: "https://private.example.com/clusters/production"},
		Breadcrumbs: []*sentry.Breadcrumb{{
			Message: "opened customer-cluster",
		}},
		Modules: map[string]string{"private-module": "1.0.0"},
		Exception: []sentry.Exception{{
			Type:  "CustomerProductionError",
			Value: "token=secret-value",
			Stacktrace: &sentry.Stacktrace{Frames: []sentry.Frame{{
				Function:    "github.com/luxury-yacht/app/backend.refresh",
				Module:      "github.com/luxury-yacht/app/backend",
				Filename:    "/Users/alice/private/refresh.go",
				AbsPath:     "/Users/alice/private/refresh.go",
				Lineno:      42,
				Colno:       7,
				ContextLine: "token := \"secret-value\"",
				PreContext:  []string{"customer@example.com"},
				PostContext: []string{"private.example.com"},
				Vars:        map[string]interface{}{"token": "secret-value"},
				InApp:       true,
			}}},
		}},
	}

	sanitized := sanitizeEvent(event, nil)

	require.Same(t, event, sanitized)
	require.Equal(t, "Backend error", sanitized.Message)
	require.Equal(t, "production", sanitized.Environment)
	require.Equal(t, "luxury-yacht@v1.2.3", sanitized.Release)
	require.Equal(t, sentry.LevelError, sanitized.Level)
	require.Equal(t, "go", sanitized.Platform)
	require.Equal(t, map[string]string{"app.surface": "backend"}, sanitized.Tags)
	require.Empty(t, sanitized.ServerName)
	require.Empty(t, sanitized.Transaction)
	require.Empty(t, sanitized.Logger)
	require.Nil(t, sanitized.Contexts)
	require.Empty(t, sanitized.User)
	require.Nil(t, sanitized.Request)
	require.Nil(t, sanitized.Breadcrumbs)
	require.Nil(t, sanitized.Modules)
	require.Len(t, sanitized.Exception, 1)
	require.Equal(t, "Error", sanitized.Exception[0].Type)
	require.Equal(t, "Backend error", sanitized.Exception[0].Value)

	frame := sanitized.Exception[0].Stacktrace.Frames[0]
	require.Equal(t, "github.com/luxury-yacht/app/backend.refresh", frame.Function)
	require.Equal(t, "github.com/luxury-yacht/app/backend", frame.Module)
	require.Equal(t, "refresh.go", frame.Filename)
	require.Empty(t, frame.AbsPath)
	require.Equal(t, 42, frame.Lineno)
	require.Equal(t, 7, frame.Colno)
	require.True(t, frame.InApp)
	require.Empty(t, frame.ContextLine)
	require.Nil(t, frame.PreContext)
	require.Nil(t, frame.PostContext)
	require.Nil(t, frame.Vars)

	payload, err := sanitized.MarshalJSON()
	require.NoError(t, err)
	for _, identifyingValue := range []string{
		"customer@example.com",
		"customer-kubeconfig:production",
		"192.0.2.10",
		"private.example.com",
		"/Users/alice",
		"secret-value",
		"CustomerProductionError",
	} {
		require.NotContains(t, string(payload), identifyingValue)
	}
}

func TestReporterDisablesAutomaticSensitiveDataAndNonErrorTelemetry(t *testing.T) {
	transport := &recordingTransport{}
	_, err := New(Config{
		DSN:       "https://public@example.com/1",
		Transport: transport,
	})
	require.NoError(t, err)

	transport.mu.Lock()
	options := transport.options
	transport.mu.Unlock()

	require.False(t, options.EnableTracing)
	require.True(t, options.DisableLogs)
	require.True(t, options.DisableMetrics)
	require.True(t, options.DisableClientReports)
	require.True(t, options.AttachStacktrace)
	require.Equal(t, -1, options.MaxBreadcrumbs)
	require.Empty(t, options.ServerName)
	require.NotNil(t, options.BeforeSend)
	require.NotNil(t, options.DataCollection)
	require.True(t, options.DataCollection.UserInfo.IsSet)
	require.False(t, options.DataCollection.UserInfo.Value)
	require.Equal(t, sentry.CollectionOff, options.DataCollection.Cookies.Mode)
	require.Equal(t, sentry.CollectionOff, options.DataCollection.QueryParams.Mode)
	require.Equal(t, sentry.CollectionOff, options.DataCollection.HTTPHeaders.Request.Mode)
	require.Equal(t, sentry.CollectionOff, options.DataCollection.HTTPHeaders.Response.Mode)
	require.Empty(t, options.DataCollection.HTTPBodies)
}

func TestReporterCapturesExceptions(t *testing.T) {
	transport := &recordingTransport{}
	reporter, err := New(Config{
		DSN:       "https://public@example.com/1",
		Transport: transport,
	})
	require.NoError(t, err)

	reporter.CaptureException(errors.New("wails failed"), Context{Source: "Wails"})

	event := transport.lastEvent()
	require.NotNil(t, event)
	require.NotEmpty(t, event.Exception)
	require.Equal(t, "Backend error", event.Exception[0].Value)
	require.Equal(t, "Error", event.Exception[0].Type)
	require.NotContains(t, event.Tags, "source")
}

func TestReporterCapturesRecoveredPanics(t *testing.T) {
	transport := &recordingTransport{}
	reporter, err := New(Config{
		DSN:       "https://public@example.com/1",
		Transport: transport,
	})
	require.NoError(t, err)

	reporter.CapturePanic("boom", Context{Source: "Process"})

	event := transport.lastEvent()
	require.NotNil(t, event)
	require.Equal(t, "Backend error", event.Message)
	require.Equal(t, sentry.LevelFatal, event.Level)
	require.NotContains(t, event.Tags, "source")
}

func TestReporterFlushesAndClosesTransportAtShutdown(t *testing.T) {
	transport := &recordingTransport{}
	reporter, err := New(Config{
		DSN:       "https://public@example.com/1",
		Transport: transport,
	})
	require.NoError(t, err)

	require.True(t, reporter.Shutdown(time.Second))

	transport.mu.Lock()
	defer transport.mu.Unlock()
	require.True(t, transport.flushed)
	require.True(t, transport.closed)
}

func TestConfigFromEnvironmentUsesOnlyStandardizedBackendDSN(t *testing.T) {
	t.Setenv("SENTRY_BACKEND_DSN", " https://runtime@example.com/2 ")

	config := ConfigFromEnvironment(
		"https://build@example.com/1",
		"luxury-yacht@v1.2.3",
		"production",
	)

	require.Equal(t, "https://runtime@example.com/2", config.DSN)
	require.Equal(t, "luxury-yacht@v1.2.3", config.Release)
	require.Equal(t, "production", config.Environment)
}
