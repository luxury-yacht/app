package main

import (
	"errors"
	"testing"
	"time"

	"github.com/luxury-yacht/app/internal/sentryreporting"
	"github.com/stretchr/testify/require"
)

type mainRecordingReporter struct {
	panics     []any
	exceptions []error
}

func (*mainRecordingReporter) Enabled() bool                                   { return true }
func (*mainRecordingReporter) SetEnabled(bool) error                           { return nil }
func (*mainRecordingReporter) CaptureLogError(string, sentryreporting.Context) {}
func (*mainRecordingReporter) Shutdown(time.Duration) bool                     { return true }

func (r *mainRecordingReporter) CaptureException(err error, _ sentryreporting.Context) {
	r.exceptions = append(r.exceptions, err)
}

func (r *mainRecordingReporter) CapturePanic(recovered any, _ sentryreporting.Context) {
	r.panics = append(r.panics, recovered)
}

func TestReportPanicCapturesAndRethrows(t *testing.T) {
	reporter := &mainRecordingReporter{}

	func() {
		defer func() {
			require.Equal(t, "boom", recover())
		}()
		func() {
			defer reportPanic(reporter)
			panic("boom")
		}()
	}()

	require.Equal(t, []any{"boom"}, reporter.panics)
}

func TestReportRunErrorCapturesOnlyFailures(t *testing.T) {
	reporter := &mainRecordingReporter{}
	failure := errors.New("webview failed")

	reportRunError(reporter, nil)
	reportRunError(reporter, failure)

	require.Equal(t, []error{failure}, reporter.exceptions)
}

func TestDefaultSentryReleaseUsesVersionedBuildIdentity(t *testing.T) {
	require.Equal(t, "luxury-yacht@v1.2.3", defaultSentryRelease(" v1.2.3 "))
	require.Empty(t, defaultSentryRelease("dev"))
}

func TestNewSentryReporterStaysDisabledWhenBuildDisablesReporting(t *testing.T) {
	t.Setenv("SENTRY_BACKEND_DSN", "https://runtime@example.com/2")

	reporter, err := newSentryReporter(false, "https://embedded@example.com/1", "v1.2.3")

	require.NoError(t, err)
	require.False(t, reporter.Enabled())
}

func TestNewSentryReporterStartsDisabledUntilPersistedPreferenceLoads(t *testing.T) {
	reporter, err := newSentryReporter(true, "https://embedded@example.com/1", "v1.2.3")

	require.NoError(t, err)
	require.False(t, reporter.Enabled())
}
