package backend

import (
	"sync"
	"testing"
	"time"

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

func (r *recordingErrorReporter) CaptureMessage(message string, context sentryreporting.Context) {
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
