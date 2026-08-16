package backend

import (
	"context"
	"errors"
	"regexp"
	"runtime"
	"sync"
	"testing"
	"time"

	"github.com/luxury-yacht/app/internal/sentry"
	"github.com/stretchr/testify/require"
)

type recordedCountMetric struct {
	name        string
	count       int64
	attributes  map[string]string
	hasDeadline bool
}

type recordingInstallationReporter struct {
	*recordingErrorReporter
	metricMu      sync.Mutex
	metrics       []recordedCountMetric
	metricResults []bool
}

type blockingInstallationReporter struct {
	*recordingErrorReporter
	started  chan struct{}
	finished chan struct{}
}

type coordinatedInstallationReporter struct {
	*recordingErrorReporter
	started  chan struct{}
	release  chan struct{}
	finished chan struct{}
}

func (r *coordinatedInstallationReporter) CaptureCountMetric(
	ctx context.Context,
	_ string,
	_ int64,
	_ map[string]string,
) bool {
	close(r.started)
	select {
	case <-r.release:
		close(r.finished)
		return true
	case <-ctx.Done():
		close(r.finished)
		return false
	}
}

func (r *blockingInstallationReporter) CaptureCountMetric(
	ctx context.Context,
	_ string,
	_ int64,
	_ map[string]string,
) bool {
	close(r.started)
	<-ctx.Done()
	close(r.finished)
	return false
}

func newRecordingInstallationReporter(results ...bool) *recordingInstallationReporter {
	return &recordingInstallationReporter{
		recordingErrorReporter: &recordingErrorReporter{},
		metricResults:          append([]bool(nil), results...),
	}
}

func (r *recordingInstallationReporter) CaptureCountMetric(
	ctx context.Context,
	name string,
	count int64,
	attributes map[string]string,
) bool {
	_, hasDeadline := ctx.Deadline()
	r.metricMu.Lock()
	defer r.metricMu.Unlock()
	r.metrics = append(r.metrics, recordedCountMetric{
		name:        name,
		count:       count,
		attributes:  attributes,
		hasDeadline: hasDeadline,
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

	settings, err := app.preferences.GetAppSettings()
	require.NoError(t, err)
	require.Regexp(t, regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`), settings.AnonymizedID)

	saved, err := app.preferences.loadSettingsFile()
	require.NoError(t, err)
	require.Equal(t, settings.AnonymizedID, saved.Telemetry.AnonymizedID)

	freshApp := newTestAppWithDefaults(t)
	freshSettings, err := freshApp.preferences.GetAppSettings()
	require.NoError(t, err)
	require.Equal(t, settings.AnonymizedID, freshSettings.AnonymizedID)

	schema, err := freshApp.preferences.GetAppSettingsSchema()
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

func TestMalformedAnonymizedIDIsReplacedInsteadOfReportedAsUserData(t *testing.T) {
	settings := defaultSettingsFile()
	settings.Telemetry.AnonymizedID = "john@example.test"
	settings.Telemetry.InstallationMetricReported = true

	created, err := ensureAnonymizedID(settings)

	require.NoError(t, err)
	require.True(t, created)
	require.Regexp(t, anonymizedIDPattern, settings.Telemetry.AnonymizedID)
	require.NotEqual(t, "john@example.test", settings.Telemetry.AnonymizedID)
	require.False(t, settings.Telemetry.InstallationMetricReported)
}

func TestInitializeErrorReportingDoesNotSynchronouslyEmitInstallationMetric(t *testing.T) {
	setTestConfigEnv(t)
	reporter := newRecordingInstallationReporter(true)
	app := NewApp(nil, reporter)

	require.NoError(t, InitializeErrorReporting(app.preferences, app.errorReporting))
	require.NoError(t, InitializeErrorReporting(app.preferences, app.errorReporting))

	reporter.metricMu.Lock()
	require.Empty(t, reporter.metrics)
	reporter.metricMu.Unlock()

	saved, err := app.preferences.loadSettingsFile()
	require.NoError(t, err)
	require.False(t, saved.Telemetry.InstallationMetricReported)
}

func TestPostStartupInstallationRegistrationEmitsMetricOnce(t *testing.T) {
	setTestConfigEnv(t)
	reporter := newRecordingInstallationReporter(true)
	app := NewApp(nil, reporter)
	require.NoError(t, InitializeErrorReporting(app.preferences, app.errorReporting))

	app.errorReporting.reportInstallationMetricIfNeeded(context.Background())
	app.errorReporting.reportInstallationMetricIfNeeded(context.Background())

	reporter.metricMu.Lock()
	require.Equal(t, []recordedCountMetric{{
		name:  installationRegisteredMetric,
		count: 1,
		attributes: map[string]string{
			"app.type": "desktop",
			"os.name":  runtime.GOOS,
			"os.arch":  runtime.GOARCH,
		},
		hasDeadline: true,
	}}, reporter.metrics)
	reporter.metricMu.Unlock()

	saved, err := app.preferences.loadSettingsFile()
	require.NoError(t, err)
	require.True(t, saved.Telemetry.InstallationMetricReported)
}

func TestInstallationMetricStaysPendingWhileReportingIsDisabled(t *testing.T) {
	setTestConfigEnv(t)
	reporter := newRecordingInstallationReporter(true)
	app := NewApp(nil, reporter)
	app.preferences.appSettings = getDefaultAppSettings()
	app.preferences.appSettings.ErrorReportingEnabled = false
	require.NoError(t, app.preferences.saveAppSettings())
	app.preferences.appSettings = nil

	require.NoError(t, InitializeErrorReporting(app.preferences, app.errorReporting))
	app.errorReporting.reportInstallationMetricIfNeeded(context.Background())

	reporter.metricMu.Lock()
	require.Empty(t, reporter.metrics)
	reporter.metricMu.Unlock()
	saved, err := app.preferences.loadSettingsFile()
	require.NoError(t, err)
	require.False(t, saved.Telemetry.InstallationMetricReported)
}

func TestInstallationMetricRetriesAfterFlushFailure(t *testing.T) {
	setTestConfigEnv(t)
	reporter := newRecordingInstallationReporter(false, true)
	app := NewApp(nil, reporter)

	require.NoError(t, InitializeErrorReporting(app.preferences, app.errorReporting))
	app.errorReporting.reportInstallationMetricIfNeeded(context.Background())
	failed, err := app.preferences.loadSettingsFile()
	require.NoError(t, err)
	require.False(t, failed.Telemetry.InstallationMetricReported)

	app.errorReporting.reportInstallationMetricIfNeeded(context.Background())
	succeeded, err := app.preferences.loadSettingsFile()
	require.NoError(t, err)
	require.True(t, succeeded.Telemetry.InstallationMetricReported)

	reporter.metricMu.Lock()
	require.Len(t, reporter.metrics, 2)
	reporter.metricMu.Unlock()
}

func TestEnablingErrorReportingEmitsPendingInstallationMetric(t *testing.T) {
	setTestConfigEnv(t)
	reporter := newRecordingInstallationReporter(true)
	app := NewApp(nil, reporter)
	app.preferences.appSettings = getDefaultAppSettings()
	app.preferences.appSettings.ErrorReportingEnabled = false
	require.NoError(t, app.preferences.saveAppSettings())
	app.preferences.appSettings = nil
	require.NoError(t, InitializeErrorReporting(app.preferences, app.errorReporting))
	setTestAppRuntimeReady(t, app, context.Background())

	_, err := app.preferences.UpdateAppPreferences(UpdateAppPreferencesRequest{Changes: []AppPreferenceChange{{
		Key:   appPreferenceErrorReportingEnabled,
		Value: true,
	}}})
	require.NoError(t, err)

	require.Eventually(t, func() bool {
		reporter.metricMu.Lock()
		defer reporter.metricMu.Unlock()
		return len(reporter.metrics) == 1
	}, time.Second, 10*time.Millisecond)
}

func TestScheduledInstallationRegistrationDoesNotBlockAndStopsWithContext(t *testing.T) {
	setTestConfigEnv(t)
	reporter := &blockingInstallationReporter{
		recordingErrorReporter: &recordingErrorReporter{},
		started:                make(chan struct{}),
		finished:               make(chan struct{}),
	}
	app := NewApp(nil, reporter)
	require.NoError(t, reporter.SetEnabled(true))
	ctx, cancel := context.WithCancel(context.Background())
	returned := make(chan struct{})
	go func() {
		app.errorReporting.scheduleInstallationMetricRegistration(ctx)
		close(returned)
	}()

	select {
	case <-returned:
	case <-time.After(250 * time.Millisecond):
		cancel()
		t.Fatal("scheduling installation registration blocked startup")
	}
	select {
	case <-reporter.started:
	case <-time.After(time.Second):
		cancel()
		t.Fatal("scheduled installation registration did not start")
	}
	cancel()
	select {
	case <-reporter.finished:
	case <-time.After(time.Second):
		t.Fatal("installation registration did not stop after cancellation")
	}
}

func TestClearAppStateWaitsForInstallationRegistrationBeforeDeletingSettings(t *testing.T) {
	setTestConfigEnv(t)
	reporter := &coordinatedInstallationReporter{
		recordingErrorReporter: &recordingErrorReporter{},
		started:                make(chan struct{}),
		release:                make(chan struct{}),
		finished:               make(chan struct{}),
	}
	app := NewApp(nil, reporter)
	setTestAppRuntimeReady(t, app, context.Background())
	require.NoError(t, reporter.SetEnabled(true))
	ensurePreferencesLoaded(t, app)
	settingsPath, err := app.preferences.getSettingsFilePath()
	require.NoError(t, err)

	registrationDone := make(chan struct{})
	go func() {
		app.errorReporting.reportInstallationMetricIfNeeded(context.Background())
		close(registrationDone)
	}()
	select {
	case <-reporter.started:
	case <-time.After(time.Second):
		t.Fatal("installation registration did not start")
	}

	clearDone := make(chan error, 1)
	go func() {
		clearDone <- app.dataManagement.ClearAppState()
	}()
	returnedBeforeRegistration := false
	select {
	case err := <-clearDone:
		require.NoError(t, err)
		returnedBeforeRegistration = true
	case <-time.After(100 * time.Millisecond):
	}

	close(reporter.release)
	select {
	case <-reporter.finished:
	case <-time.After(time.Second):
		t.Fatal("installation registration did not finish")
	}
	select {
	case <-registrationDone:
	case <-time.After(time.Second):
		t.Fatal("installation registration worker did not return")
	}
	if !returnedBeforeRegistration {
		select {
		case err := <-clearDone:
			require.NoError(t, err)
		case <-time.After(time.Second):
			t.Fatal("clear app state did not finish")
		}
	}

	require.False(t, returnedBeforeRegistration, "factory reset must join installation registration before deleting settings")
	require.NoFileExists(t, settingsPath)
}

func TestInstallationTelemetryWarningIsLocalOnly(t *testing.T) {
	app := newTestAppWithDefaults(t)
	app.errorReporting.warnInstallationTelemetry("Could not save acknowledgement", errors.New("disk full"))

	entries := app.appLogs.logger.GetEntries()
	require.Len(t, entries, 1)
	require.Equal(t, "WARN", entries[0].Level)
	require.Equal(t, "Settings", entries[0].Source)
	require.Equal(t, "Could not save acknowledgement: disk full", entries[0].Message)

	(&ErrorReportingService{}).warnInstallationTelemetry("ignored", errors.New("no logger"))
}

var _ sentryreporting.MetricReporter = (*recordingInstallationReporter)(nil)
var _ sentryreporting.MetricReporter = (*blockingInstallationReporter)(nil)
var _ sentryreporting.MetricReporter = (*coordinatedInstallationReporter)(nil)
