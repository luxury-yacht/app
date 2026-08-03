package backend

import (
	"errors"
	"regexp"
	"runtime"
	"sync"
	"testing"
	"time"

	"github.com/luxury-yacht/app/internal/sentryreporting"
	"github.com/stretchr/testify/require"
)

type recordedCountMetric struct {
	name       string
	count      int64
	attributes map[string]string
	timeout    time.Duration
}

type recordingInstallationReporter struct {
	*recordingErrorReporter
	metricMu      sync.Mutex
	metrics       []recordedCountMetric
	metricResults []bool
}

func newRecordingInstallationReporter(results ...bool) *recordingInstallationReporter {
	return &recordingInstallationReporter{
		recordingErrorReporter: &recordingErrorReporter{},
		metricResults:          append([]bool(nil), results...),
	}
}

func (r *recordingInstallationReporter) CaptureCountMetric(
	name string,
	count int64,
	attributes map[string]string,
	timeout time.Duration,
) bool {
	r.metricMu.Lock()
	defer r.metricMu.Unlock()
	r.metrics = append(r.metrics, recordedCountMetric{
		name:       name,
		count:      count,
		attributes: attributes,
		timeout:    timeout,
	})
	if len(r.metricResults) == 0 {
		return true
	}
	result := r.metricResults[0]
	r.metricResults = r.metricResults[1:]
	return result
}

func TestAppCreatesAndPersistsAnonymizedID(t *testing.T) {
	setTestConfigEnv(t)
	app := newTestAppWithDefaults(t)

	settings, err := app.GetAppSettings()
	require.NoError(t, err)
	require.Regexp(t, regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`), settings.AnonymizedID)

	saved, err := app.loadSettingsFile()
	require.NoError(t, err)
	require.Equal(t, settings.AnonymizedID, saved.Telemetry.AnonymizedID)

	freshApp := newTestAppWithDefaults(t)
	freshSettings, err := freshApp.GetAppSettings()
	require.NoError(t, err)
	require.Equal(t, settings.AnonymizedID, freshSettings.AnonymizedID)

	schema, err := freshApp.GetAppSettingsSchema()
	require.NoError(t, err)
	require.Equal(t, settings.AnonymizedID, schema.AnonymizedID)
}

func TestCreatingReplacementAnonymizedIDResetsInstallationMetricAcknowledgement(t *testing.T) {
	settings := defaultSettingsFile()
	settings.Telemetry.InstallationMetricReported = true

	created, err := ensureAnonymizedID(settings)

	require.NoError(t, err)
	require.True(t, created)
	require.NotEmpty(t, settings.Telemetry.AnonymizedID)
	require.False(t, settings.Telemetry.InstallationMetricReported)
}

func TestInitializeErrorReportingEmitsInstallationMetricOnce(t *testing.T) {
	setTestConfigEnv(t)
	reporter := newRecordingInstallationReporter(true)
	app := NewApp(reporter)

	require.NoError(t, InitializeErrorReporting(app))
	require.NoError(t, InitializeErrorReporting(app))

	reporter.metricMu.Lock()
	require.Equal(t, []recordedCountMetric{{
		name:  installationRegisteredMetric,
		count: 1,
		attributes: map[string]string{
			"app.type": "desktop",
			"os.name":  runtime.GOOS,
			"os.arch":  runtime.GOARCH,
		},
		timeout: installationMetricFlushTimeout,
	}}, reporter.metrics)
	reporter.metricMu.Unlock()

	saved, err := app.loadSettingsFile()
	require.NoError(t, err)
	require.True(t, saved.Telemetry.InstallationMetricReported)
}

func TestInstallationMetricWaitsForConsent(t *testing.T) {
	setTestConfigEnv(t)
	reporter := newRecordingInstallationReporter(true)
	app := NewApp(reporter)
	app.appSettings = getDefaultAppSettings()
	app.appSettings.ErrorReportingEnabled = false
	require.NoError(t, app.saveAppSettings())
	app.appSettings = nil

	require.NoError(t, InitializeErrorReporting(app))

	reporter.metricMu.Lock()
	require.Empty(t, reporter.metrics)
	reporter.metricMu.Unlock()
	saved, err := app.loadSettingsFile()
	require.NoError(t, err)
	require.False(t, saved.Telemetry.InstallationMetricReported)
}

func TestInstallationMetricRetriesAfterFlushFailure(t *testing.T) {
	setTestConfigEnv(t)
	reporter := newRecordingInstallationReporter(false, true)
	app := NewApp(reporter)

	require.NoError(t, InitializeErrorReporting(app))
	failed, err := app.loadSettingsFile()
	require.NoError(t, err)
	require.False(t, failed.Telemetry.InstallationMetricReported)

	require.NoError(t, InitializeErrorReporting(app))
	succeeded, err := app.loadSettingsFile()
	require.NoError(t, err)
	require.True(t, succeeded.Telemetry.InstallationMetricReported)

	reporter.metricMu.Lock()
	require.Len(t, reporter.metrics, 2)
	reporter.metricMu.Unlock()
}

func TestEnablingErrorReportingEmitsPendingInstallationMetric(t *testing.T) {
	setTestConfigEnv(t)
	reporter := newRecordingInstallationReporter(true)
	app := NewApp(reporter)
	app.appSettings = getDefaultAppSettings()
	app.appSettings.ErrorReportingEnabled = false
	require.NoError(t, app.saveAppSettings())
	app.appSettings = nil
	require.NoError(t, InitializeErrorReporting(app))

	_, err := app.UpdateAppPreferences(UpdateAppPreferencesRequest{Changes: []AppPreferenceChange{{
		Key:   appPreferenceErrorReportingEnabled,
		Value: true,
	}}})
	require.NoError(t, err)

	reporter.metricMu.Lock()
	require.Len(t, reporter.metrics, 1)
	reporter.metricMu.Unlock()
}

func TestInstallationTelemetryWarningIsLocalOnly(t *testing.T) {
	app := newTestAppWithDefaults(t)
	app.warnInstallationTelemetry("Could not save acknowledgement", errors.New("disk full"))

	entries := app.logger.GetEntries()
	require.Len(t, entries, 1)
	require.Equal(t, "WARN", entries[0].Level)
	require.Equal(t, "Settings", entries[0].Source)
	require.Equal(t, "Could not save acknowledgement: disk full", entries[0].Message)

	(&App{}).warnInstallationTelemetry("ignored", errors.New("no logger"))
}

var _ sentryreporting.MetricReporter = (*recordingInstallationReporter)(nil)
