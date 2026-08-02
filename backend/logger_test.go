package backend

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/getsentry/sentry-go"
	"github.com/luxury-yacht/app/internal/sentryreporting"
	"github.com/stretchr/testify/require"
)

type capturedReport struct {
	message string
	context sentryreporting.Context
}

type recordingErrorReporter struct {
	mu             sync.Mutex
	messages       []capturedReport
	enabled        bool
	enabledChanges []bool
	setEnabledFn   func(bool)
}

type loggerSentryTransport struct {
	event *sentry.Event
}

func (*loggerSentryTransport) Configure(sentry.ClientOptions) {}

func (t *loggerSentryTransport) SendEvent(event *sentry.Event) {
	t.event = event
}

func (*loggerSentryTransport) Flush(time.Duration) bool              { return true }
func (*loggerSentryTransport) FlushWithContext(context.Context) bool { return true }
func (*loggerSentryTransport) Close()                                {}

func captureLoggerFailureFromObjectCatalog(logger *Logger) {
	logger.Error("object catalog failed for private-cluster", "ObjectCatalog", "private-cluster")
}

func (r *recordingErrorReporter) Enabled() bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.enabled
}

func (r *recordingErrorReporter) SetEnabled(enabled bool) error {
	r.mu.Lock()
	r.enabled = enabled
	r.enabledChanges = append(r.enabledChanges, enabled)
	callback := r.setEnabledFn
	r.mu.Unlock()
	if callback != nil {
		callback(enabled)
	}
	return nil
}

func (*recordingErrorReporter) CaptureException(error, sentryreporting.Context) {}
func (*recordingErrorReporter) CapturePanic(any, sentryreporting.Context)       {}
func (*recordingErrorReporter) Shutdown(time.Duration) bool                     { return true }

func (r *recordingErrorReporter) CaptureLogError(message string, context sentryreporting.Context) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.messages = append(r.messages, capturedReport{message: message, context: context})
}

func TestLoggerReportsOnlyErrorsWithClusterIdentity(t *testing.T) {
	reporter := &recordingErrorReporter{}
	logger := NewLogger(10, reporter)

	logger.Info("refresh started", "Refresh", "cluster-a", "Production")
	logger.Error("refresh failed", "Refresh", "cluster-a", "Production")

	reporter.mu.Lock()
	defer reporter.mu.Unlock()
	require.Equal(t, []capturedReport{{
		message: "refresh failed",
		context: sentryreporting.Context{Source: "Refresh", ClusterID: "cluster-a"},
	}}, reporter.messages)
}

func TestLoggerSentryReportIncludesOriginalMessageAndCluster(t *testing.T) {
	transport := &loggerSentryTransport{}
	reporter, err := sentryreporting.New(sentryreporting.Config{
		DSN:       "https://public@example.com/1",
		Transport: transport,
	})
	require.NoError(t, err)
	logger := NewLogger(10, reporter)

	captureLoggerFailureFromObjectCatalog(logger)

	require.NotNil(t, transport.event)
	require.Equal(t, "object catalog failed for private-cluster", transport.event.Exception[0].Value)
	require.Equal(t, "private-cluster", transport.event.Tags["clusterId"])
	require.Empty(t, transport.event.Fingerprint)
}

func TestNewAppPassesErrorReporterToApplicationLogger(t *testing.T) {
	reporter := &recordingErrorReporter{}
	app := NewApp(reporter)

	app.logger.Error("startup failed", "App")

	reporter.mu.Lock()
	defer reporter.mu.Unlock()
	require.Equal(t, []capturedReport{{
		message: "startup failed",
		context: sentryreporting.Context{Source: "App"},
	}}, reporter.messages)
}
