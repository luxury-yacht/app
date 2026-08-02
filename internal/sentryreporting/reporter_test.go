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

	reporter.CaptureLogError("before opt in", Context{ClusterID: "cluster-a"})
	require.Zero(t, transport.eventCount())

	require.NoError(t, reporter.SetEnabled(true))
	require.True(t, reporter.Enabled())
	reporter.CaptureLogError("after opt in", Context{ClusterID: "cluster-a"})
	require.Equal(t, 1, transport.eventCount())

	require.NoError(t, reporter.SetEnabled(false))
	require.False(t, reporter.Enabled())
	reporter.CaptureLogError("after opt out", Context{ClusterID: "cluster-a"})
	require.Equal(t, 1, transport.eventCount())

	transport.mu.Lock()
	defer transport.mu.Unlock()
	require.True(t, transport.closed)
	require.False(t, transport.flushed)
}

func TestReporterCapturesOriginalMessageAndContext(t *testing.T) {
	transport := &recordingTransport{}
	reporter, err := New(Config{
		DSN:         "https://public@example.com/1",
		Environment: "production",
		Release:     "luxury-yacht@v1.2.3",
		Transport:   transport,
	})
	require.NoError(t, err)

	reporter.CaptureLogError("refresh subsystem failed for cluster-a", Context{
		Source:    "Refresh",
		ClusterID: "cluster-a",
	})

	event := transport.lastEvent()
	require.NotNil(t, event)
	require.Empty(t, event.Message)
	require.Equal(t, "production", event.Environment)
	require.Equal(t, "luxury-yacht@v1.2.3", event.Release)
	require.Equal(t, "Refresh", event.Tags["source"])
	require.Equal(t, "cluster-a", event.Tags["clusterId"])
	require.Len(t, event.Tags, 2)
	require.Empty(t, event.Fingerprint)
	require.Len(t, event.Exception, 1)
	require.Equal(t, "refresh subsystem failed for cluster-a", event.Exception[0].Value)
	require.NotNil(t, event.Exception[0].Stacktrace)
	require.NotEmpty(t, event.Exception[0].Stacktrace.Frames)
}

func TestReporterUsesSentryDataCollectionDefaults(t *testing.T) {
	transport := &recordingTransport{}
	_, err := New(Config{
		DSN:       "https://public@example.com/1",
		Transport: transport,
	})
	require.NoError(t, err)

	transport.mu.Lock()
	options := transport.options
	transport.mu.Unlock()

	require.Nil(t, options.BeforeSend)
	require.NotNil(t, options.DataCollection)
	require.True(t, options.DataCollection.UserInfo.Value)
	require.Equal(t, sentry.CollectionDenyList, options.DataCollection.Cookies.Mode)
	require.Equal(t, sentry.CollectionDenyList, options.DataCollection.HTTPHeaders.Request.Mode)
	require.Equal(t, sentry.CollectionDenyList, options.DataCollection.HTTPHeaders.Response.Mode)
	require.Equal(t, sentry.CollectionDenyList, options.DataCollection.QueryParams.Mode)
	require.ElementsMatch(t, []sentry.BodyType{
		sentry.BodyIncomingRequest,
		sentry.BodyOutgoingRequest,
		sentry.BodyIncomingResponse,
	}, options.DataCollection.HTTPBodies)
}

func TestReporterCapturesExceptions(t *testing.T) {
	transport := &recordingTransport{}
	reporter, err := New(Config{
		DSN:       "https://public@example.com/1",
		Transport: transport,
	})
	require.NoError(t, err)

	reporter.CaptureException(errors.New("wails failed for cluster-a"), Context{Source: "Wails"})

	event := transport.lastEvent()
	require.NotNil(t, event)
	require.NotEmpty(t, event.Exception)
	require.Equal(t, "wails failed for cluster-a", event.Exception[0].Value)
	require.Equal(t, "Wails", event.Tags["source"])
}

func TestReporterCapturesRecoveredPanics(t *testing.T) {
	transport := &recordingTransport{}
	reporter, err := New(Config{
		DSN:       "https://public@example.com/1",
		Transport: transport,
	})
	require.NoError(t, err)

	reporter.CapturePanic("boom for cluster-a", Context{Source: "Process"})

	event := transport.lastEvent()
	require.NotNil(t, event)
	require.Equal(t, "boom for cluster-a", event.Message)
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
