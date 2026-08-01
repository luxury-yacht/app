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

func TestNewReturnsDisabledReporterWithoutDSN(t *testing.T) {
	reporter, err := New(Config{})

	require.NoError(t, err)
	require.False(t, reporter.Enabled())
}

func TestReporterCapturesMessageWithAppAndClusterContext(t *testing.T) {
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
	require.Equal(t, "refresh subsystem failed", event.Message)
	require.Equal(t, "production", event.Environment)
	require.Equal(t, "luxury-yacht@v1.2.3", event.Release)
	require.Equal(t, "backend", event.Tags["app.surface"])
	require.Equal(t, "Refresh", event.Tags["source"])
	require.Equal(t, "cluster-a", event.Tags["clusterId"])
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
	require.Equal(t, "luxury-yacht-desktop", options.ServerName)
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
	require.Equal(t, "wails failed", event.Exception[0].Value)
	require.Equal(t, "Wails", event.Tags["source"])
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
	require.Equal(t, "boom", event.Message)
	require.Equal(t, sentry.LevelFatal, event.Level)
	require.Equal(t, "Process", event.Tags["source"])
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

func TestConfigFromEnvironmentOverridesBuildDefaults(t *testing.T) {
	t.Setenv("SENTRY_DSN", " https://runtime@example.com/2 ")
	t.Setenv("SENTRY_RELEASE", " luxury-yacht@v2.0.0 ")
	t.Setenv("SENTRY_ENVIRONMENT", " staging ")

	config := ConfigFromEnvironment(
		"https://build@example.com/1",
		"luxury-yacht@v1.2.3",
		"production",
	)

	require.Equal(t, "https://runtime@example.com/2", config.DSN)
	require.Equal(t, "luxury-yacht@v2.0.0", config.Release)
	require.Equal(t, "staging", config.Environment)
}
