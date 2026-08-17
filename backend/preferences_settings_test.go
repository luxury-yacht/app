package backend

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/system"
	"github.com/stretchr/testify/require"
	"k8s.io/client-go/rest"
)

type settingsMetricsPoller struct {
	mu        sync.Mutex
	intervals []time.Duration
}

func (*settingsMetricsPoller) Start(context.Context) error { return nil }
func (*settingsMetricsPoller) Stop(context.Context) error  { return nil }

func (p *settingsMetricsPoller) SetInterval(interval time.Duration) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.intervals = append(p.intervals, interval)
}

func (p *settingsMetricsPoller) recordedIntervals() []time.Duration {
	p.mu.Lock()
	defer p.mu.Unlock()
	return append([]time.Duration(nil), p.intervals...)
}

type failingSettingsReporter struct {
	*recordingInstallationReporter
	err error
}

func (r *failingSettingsReporter) SetEnabled(enabled bool) error {
	_ = r.recordingErrorReporter.SetEnabled(enabled)
	return r.err
}

func ensurePreferencesLoaded(t testing.TB, preferences *PreferencesService) PreferencesSnapshot {
	t.Helper()
	snapshot, err := preferences.EnsureLoaded()
	require.NoError(t, err)
	return snapshot
}

func updatePreference(preferences *PreferencesService, key string, value any) error {
	_, err := preferences.UpdateAppPreferences(UpdateAppPreferencesRequest{
		Changes: []AppPreferenceChange{{Key: key, Value: value}},
	})
	return err
}

func updatePreferences(preferences *PreferencesService, changes ...AppPreferenceChange) error {
	_, err := preferences.UpdateAppPreferences(UpdateAppPreferencesRequest{Changes: changes})
	return err
}

func TestAppStatePathResolversDoNotCreateDirectories(t *testing.T) {
	base := t.TempDir()
	t.Setenv("HOME", filepath.Join(base, "home"))
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(base, "config"))
	t.Setenv("XDG_CACHE_HOME", filepath.Join(base, "cache"))
	t.Setenv("APPDATA", filepath.Join(base, "appdata"))
	preferences := NewPreferencesService(nil, nil, nil)
	uiState := NewUIStateStore()
	favorites := NewFavoritesService()

	settingsPath, err := preferences.getSettingsFilePath()
	require.NoError(t, err)
	persistencePath, err := uiState.getPersistenceFilePath()
	require.NoError(t, err)
	favoritesPath, err := favorites.getFavoritesFilePath()
	require.NoError(t, err)
	cachePath, err := preferences.cacheDirPath()
	require.NoError(t, err)

	require.NoDirExists(t, filepath.Dir(settingsPath))
	require.Equal(t, filepath.Dir(settingsPath), filepath.Dir(persistencePath))
	require.Equal(t, filepath.Dir(settingsPath), filepath.Dir(favoritesPath))
	require.NoDirExists(t, cachePath)
}

func setTestConfigEnv(t *testing.T) {
	t.Helper()
	baseDir := t.TempDir()
	t.Setenv("HOME", baseDir)
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(baseDir, ".config"))
	t.Setenv("XDG_CACHE_HOME", filepath.Join(baseDir, ".cache"))
	t.Setenv("APPDATA", filepath.Join(baseDir, "AppData", "Roaming"))
}

func writeTestFileWithParents(t *testing.T, path string, data []byte, mode os.FileMode) {
	t.Helper()
	require.NoError(t, os.MkdirAll(filepath.Dir(path), 0o755))
	require.NoError(t, os.WriteFile(path, data, mode))
}

func TestClearAppStateRemovesCacheDir(t *testing.T) {
	setTestConfigEnv(t)
	app := newSettingsEffectsTestFixture(t)
	setTestAppRuntimeReady(t, app.Lifecycle, context.Background())

	// The app cache dir lives under the user cache dir (redirected into a temp
	// dir by setTestConfigEnv). Seed the subdirs the three cache subsystems use
	// so we can prove Factory Reset removes cached data, not just config files.
	cacheBase, err := os.UserCacheDir()
	require.NoError(t, err)
	cacheDir := filepath.Join(cacheBase, "luxury-yacht")
	for _, sub := range []string{"discovery", "spill", "diagnostics"} {
		dir := filepath.Join(cacheDir, sub)
		require.NoError(t, os.MkdirAll(dir, 0o755))
		require.NoError(t, os.WriteFile(filepath.Join(dir, "cached"), []byte("x"), 0o644))
	}

	// A sibling under the user cache dir must be left untouched — Factory Reset
	// only clears this app's cache subtree.
	sibling := filepath.Join(cacheBase, "other-app")
	require.NoError(t, os.MkdirAll(sibling, 0o755))

	require.NoError(t, app.DataManagement.ClearAppState())

	_, statErr := os.Stat(cacheDir)
	require.Truef(t, os.IsNotExist(statErr),
		"expected app cache dir %q to be removed, stat err=%v", cacheDir, statErr)

	_, siblingErr := os.Stat(sibling)
	require.NoError(t, siblingErr, "unrelated sibling cache dir must be preserved")
}

func TestAppLoadWindowSettingsDefaultWhenMissing(t *testing.T) {
	setTestConfigEnv(t)
	app := newSettingsEffectsTestFixture(t)

	settings, err := app.Preferences.LoadWindowSettings()
	require.NoError(t, err)
	require.NotNil(t, settings)
	require.Equal(t, int(1200), settings.Width)
	require.Equal(t, int(800), settings.Height)
}

func TestAppLoadWindowSettingsReadsExistingFile(t *testing.T) {
	setTestConfigEnv(t)
	app := newSettingsEffectsTestFixture(t)

	configPath, err := app.Preferences.getSettingsFilePath()
	require.NoError(t, err)

	want := &WindowSettings{X: 10, Y: 20, Width: 900, Height: 600, Maximized: true}
	settings := &settingsFile{
		SchemaVersion: settingsSchemaVersion,
		UpdatedAt:     time.Now().UTC(),
		Preferences: settingsPreferences{
			AppearanceMode:           "system",
			GridTablePersistenceMode: "shared",
		},
		UI: settingsUI{Window: *want},
	}
	bytes, err := json.Marshal(settings)
	require.NoError(t, err)
	writeTestFileWithParents(t, configPath, bytes, 0o644)

	got, err := app.Preferences.LoadWindowSettings()
	require.NoError(t, err)
	require.Equal(t, want, got)
	require.Equal(t, want, app.Preferences.windowSettings)
}

func TestAppSaveWindowSettingsPreservesInMemoryKubeconfigSelection(t *testing.T) {
	setTestConfigEnv(t)
	app := newSettingsEffectsTestFixture(t)
	setTestAppRuntimeReady(t, app.Lifecycle, context.Background())
	app.Preferences.appSettings = getDefaultAppSettings()
	app.Preferences.appSettings.SelectedKubeconfigs = []string{"/new/config:ctx-new"}

	settings := defaultSettingsFile()
	settings.Kubeconfig.Selected = []string{"/old/config:ctx-old"}
	require.NoError(t, app.Preferences.saveSettingsFile(settings))

	app.DesktopShell.windowGeometry = func() (WindowGeometry, error) {
		return WindowGeometry{X: 10, Y: 20, Width: 900, Height: 600}, nil
	}

	require.NoError(t, app.Preferences.SaveWindowSettings())

	saved, err := app.Preferences.loadSettingsFile()
	require.NoError(t, err)
	require.Equal(t, []string{"/new/config:ctx-new"}, saved.Kubeconfig.Selected)
	require.Equal(t, 10, saved.UI.Window.X)
	require.Equal(t, 20, saved.UI.Window.Y)
	require.Equal(t, 900, saved.UI.Window.Width)
	require.Equal(t, 600, saved.UI.Window.Height)
}

func TestAppGetAppSettingsReturnsDefaultWhenMissing(t *testing.T) {
	setTestConfigEnv(t)
	app := newSettingsEffectsTestFixture(t)

	settings, err := app.Preferences.GetAppSettings()
	require.NoError(t, err)
	expected := getDefaultAppSettings()
	expected.AnonymizedID = settings.AnonymizedID
	require.Equal(t, expected, settings)
	require.Equal(t, settings, app.Preferences.appSettings)
}

func TestErrorReportingPreferenceDefaultsEnabledInSettingsAndSchema(t *testing.T) {
	setTestConfigEnv(t)
	app := newSettingsEffectsTestFixture(t)

	settings, err := app.Preferences.GetAppSettings()
	require.NoError(t, err)
	require.True(t, settings.ErrorReportingEnabled)

	schema, err := app.Preferences.GetAppSettingsSchema()
	require.NoError(t, err)
	byKey := make(map[string]AppPreferenceSchema, len(schema.Preferences))
	for _, preference := range schema.Preferences {
		byKey[preference.Key] = preference
	}
	require.Equal(t, "boolean", byKey[appPreferenceErrorReportingEnabled].Type)
	require.Equal(t, true, byKey[appPreferenceErrorReportingEnabled].DefaultValue)
	require.Equal(t, true, byKey[appPreferenceErrorReportingEnabled].CurrentValue)
	require.True(t, byKey[appPreferenceErrorReportingEnabled].RuntimeSideEffect)
}

func TestErrorReportingPreferencePersistsBeforeApplyingRuntimeState(t *testing.T) {
	setTestConfigEnv(t)
	reporter := &recordingErrorReporter{}
	app := newSettingsEffectsTestFixture(t, reporter)
	configPath, err := app.Preferences.getSettingsFilePath()
	require.NoError(t, err)

	reporter.setEnabledFn = func(enabled bool) {
		require.False(t, enabled)
		data, readErr := os.ReadFile(configPath)
		require.NoError(t, readErr)
		require.Contains(t, string(data), `"errorReportingEnabled":false`)
	}

	response, err := app.Preferences.UpdateAppPreferences(UpdateAppPreferencesRequest{Changes: []AppPreferenceChange{{
		Key:   appPreferenceErrorReportingEnabled,
		Value: false,
	}}})
	require.NoError(t, err)
	require.False(t, response.Settings.ErrorReportingEnabled)

	reporter.mu.Lock()
	defer reporter.mu.Unlock()
	require.Equal(t, []bool{false}, reporter.enabledChanges)
}

func TestInitializeErrorReportingHonorsPersistedOptOut(t *testing.T) {
	setTestConfigEnv(t)
	reporter := &recordingErrorReporter{}
	app := newSettingsEffectsTestFixture(t, reporter)
	app.Preferences.appSettings = getDefaultAppSettings()
	app.Preferences.appSettings.ErrorReportingEnabled = false
	require.NoError(t, app.Preferences.saveAppSettings())
	app.Preferences.appSettings = nil

	require.NoError(t, InitializeErrorReporting(app.Preferences, app.ErrorReporting))
	require.False(t, reporter.Enabled())

	reporter.mu.Lock()
	defer reporter.mu.Unlock()
	require.Equal(t, []bool{false}, reporter.enabledChanges)
}

func TestInitializeErrorReportingEnablesDefaultPreferenceAfterLoad(t *testing.T) {
	setTestConfigEnv(t)
	reporter := &recordingErrorReporter{}
	app := newSettingsEffectsTestFixture(t, reporter)

	require.NoError(t, InitializeErrorReporting(app.Preferences, app.ErrorReporting))
	require.True(t, reporter.Enabled())

	reporter.mu.Lock()
	defer reporter.mu.Unlock()
	require.Equal(t, []bool{true}, reporter.enabledChanges)
}

func TestInitializeErrorReportingKeepsReporterDisabledWhenSettingsCannotLoad(t *testing.T) {
	setTestConfigEnv(t)
	reporter := &recordingErrorReporter{enabled: true}
	app := newSettingsEffectsTestFixture(t, reporter)
	configPath, err := app.Preferences.getSettingsFilePath()
	require.NoError(t, err)
	writeTestFileWithParents(t, configPath, []byte(`{"preferences":`), 0o644)

	require.Error(t, InitializeErrorReporting(app.Preferences, app.ErrorReporting))
	require.False(t, reporter.Enabled())

	reporter.mu.Lock()
	defer reporter.mu.Unlock()
	require.Equal(t, []bool{false}, reporter.enabledChanges)
}

func TestSettingsRPCsSurfaceCorruptSettingsInsteadOfReturningDefaultOnValues(t *testing.T) {
	setTestConfigEnv(t)
	app := newSettingsEffectsTestFixture(t, &recordingErrorReporter{})
	configPath, err := app.Preferences.getSettingsFilePath()
	require.NoError(t, err)
	writeTestFileWithParents(t, configPath, []byte(`{"preferences":`), 0o644)

	settings, settingsErr := app.Preferences.GetAppSettings()
	require.Error(t, settingsErr)
	require.Nil(t, settings)

	schema, schemaErr := app.Preferences.GetAppSettingsSchema()
	require.Error(t, schemaErr)
	require.Nil(t, schema)
}

func TestInitializeErrorReportingAllowsMissingAppOrReporter(t *testing.T) {
	require.NoError(t, InitializeErrorReporting(nil, nil))
	app := newSettingsEffectsTestFixture(t)
	require.NoError(t, InitializeErrorReporting(app.Preferences, app.ErrorReporting))
}

func TestAppSaveAndLoadAppSettingsRoundTrip(t *testing.T) {
	setTestConfigEnv(t)
	app := newSettingsEffectsTestFixture(t)

	app.Preferences.appSettings = &AppSettings{
		AppearanceMode:                           "dark",
		SelectedKubeconfigs:                      []string{"/tmp/config:ctx"},
		UseShortResourceNames:                    true,
		DimInactiveNamespaces:                    false,
		ExclusiveNamespaces:                      false,
		AutoRefreshEnabled:                       false,
		RefreshBackgroundClustersEnabled:         false,
		MetricsRefreshIntervalMs:                 7000,
		KubernetesClientQPS:                      250,
		KubernetesClientBurst:                    500,
		PermissionSSRRFetchConcurrency:           16,
		ObjPanelLogsBufferMaxSize:                2500,
		ObjPanelLogsTargetPerScopeLimit:          144,
		ObjPanelLogsTargetGlobalLimit:            180,
		ObjPanelLogsAPITimestampFormat:           "HH:mm:ss.SSS",
		ObjPanelLogsAPITimestampUseLocalTimeZone: true,
		GridTablePersistenceMode:                 "namespaced",
		DefaultObjectPanelPosition:               "floating",
		PaletteHueLight:                          200,
		PaletteSaturationLight:                   60,
		PaletteBrightnessLight:                   -20,
		PaletteHueDark:                           120,
		PaletteSaturationDark:                    40,
		PaletteBrightnessDark:                    10,
		AccentColorLight:                         "#326ce5.",
		AccentColorDark:                          "#f59e0b",
	}

	require.NoError(t, app.Preferences.saveAppSettings())
	configPath, err := app.Preferences.getSettingsFilePath()
	require.NoError(t, err)
	savedBytes, err := os.ReadFile(configPath)
	require.NoError(t, err)
	require.Contains(t, string(savedBytes), `"appearanceMode":"dark"`)
	require.NotContains(t, string(savedBytes), `"theme":"dark"`)
	require.NotContains(t, string(savedBytes), `"max`+"TableRows"+`"`)

	app.Preferences.appSettings = nil
	ensurePreferencesLoaded(t, app.Preferences)
	require.Equal(t, "dark", app.Preferences.appSettings.AppearanceMode)
	require.True(t, app.Preferences.appSettings.UseShortResourceNames)
	require.False(t, app.Preferences.appSettings.DimInactiveNamespaces)
	require.False(t, app.Preferences.appSettings.ExclusiveNamespaces)
	require.Equal(t, []string{"/tmp/config:ctx"}, app.Preferences.appSettings.SelectedKubeconfigs)
	require.False(t, app.Preferences.appSettings.AutoRefreshEnabled)
	require.False(t, app.Preferences.appSettings.RefreshBackgroundClustersEnabled)
	require.Equal(t, 7000, app.Preferences.appSettings.MetricsRefreshIntervalMs)
	require.Equal(t, 250, app.Preferences.appSettings.KubernetesClientQPS)
	require.Equal(t, 500, app.Preferences.appSettings.KubernetesClientBurst)
	require.Equal(t, 16, app.Preferences.appSettings.PermissionSSRRFetchConcurrency)
	require.Equal(t, 2500, app.Preferences.appSettings.ObjPanelLogsBufferMaxSize)
	require.Equal(t, 144, app.Preferences.appSettings.ObjPanelLogsTargetPerScopeLimit)
	require.Equal(t, 180, app.Preferences.appSettings.ObjPanelLogsTargetGlobalLimit)
	require.Equal(t, "HH:mm:ss.SSS", app.Preferences.appSettings.ObjPanelLogsAPITimestampFormat)
	require.True(t, app.Preferences.appSettings.ObjPanelLogsAPITimestampUseLocalTimeZone)
	require.Equal(t, "namespaced", app.Preferences.appSettings.GridTablePersistenceMode)
	require.Equal(t, "floating", app.Preferences.appSettings.DefaultObjectPanelPosition)
	require.Equal(t, 200, app.Preferences.appSettings.PaletteHueLight)
	require.Equal(t, 60, app.Preferences.appSettings.PaletteSaturationLight)
	require.Equal(t, -20, app.Preferences.appSettings.PaletteBrightnessLight)
	require.Equal(t, 120, app.Preferences.appSettings.PaletteHueDark)
	require.Equal(t, 40, app.Preferences.appSettings.PaletteSaturationDark)
	require.Equal(t, 10, app.Preferences.appSettings.PaletteBrightnessDark)
	require.Equal(t, "#326ce5.", app.Preferences.appSettings.AccentColorLight)
	require.Equal(t, "#f59e0b", app.Preferences.appSettings.AccentColorDark)
}

func TestAppSetAppearanceModePersistsAndLogs(t *testing.T) {
	setTestConfigEnv(t)
	app := newSettingsEffectsTestFixture(t)

	require.NoError(t, updatePreference(app.Preferences, appPreferenceAppearanceMode, "dark"))
	require.Equal(t, "dark", app.Preferences.appSettings.AppearanceMode)

	app.Preferences.appSettings = nil
	ensurePreferencesLoaded(t, app.Preferences)
	require.Equal(t, "dark", app.Preferences.appSettings.AppearanceMode)

	entries := app.AppLogs.logger.GetEntries()
	require.NotEmpty(t, entries)
	last := entries[len(entries)-1]
	require.Equal(t, "INFO", last.Level)
	require.Contains(t, last.Message, "Appearance mode changed to: dark")
}

func TestAppSetAppearanceModeRejectsInvalidValues(t *testing.T) {
	setTestConfigEnv(t)
	app := newSettingsEffectsTestFixture(t)

	err := updatePreference(app.Preferences, appPreferenceAppearanceMode, "blue")
	require.Error(t, err)
	require.Contains(t, err.Error(), "invalid appearance mode")
}

func TestAppSetUseShortResourceNamesPersists(t *testing.T) {
	setTestConfigEnv(t)
	app := newSettingsEffectsTestFixture(t)

	require.NoError(t, updatePreference(app.Preferences, appPreferenceUseShortResourceNames, true))
	require.True(t, app.Preferences.appSettings.UseShortResourceNames)

	app.Preferences.appSettings = nil
	ensurePreferencesLoaded(t, app.Preferences)
	require.True(t, app.Preferences.appSettings.UseShortResourceNames)

	entries := app.AppLogs.logger.GetEntries()
	require.NotEmpty(t, entries)
	last := entries[len(entries)-1]
	require.Equal(t, "INFO", last.Level)
	require.Contains(t, last.Message, "Use short resource names changed to: true")
}

func TestAppSetDimInactiveNamespacesPersists(t *testing.T) {
	setTestConfigEnv(t)
	app := newSettingsEffectsTestFixture(t)

	settings, err := app.Preferences.GetAppSettings()
	require.NoError(t, err)
	require.True(t, settings.DimInactiveNamespaces)

	require.NoError(t, updatePreference(app.Preferences, appPreferenceDimInactiveNamespaces, false))
	require.False(t, app.Preferences.appSettings.DimInactiveNamespaces)

	app.Preferences.appSettings = nil
	ensurePreferencesLoaded(t, app.Preferences)
	require.False(t, app.Preferences.appSettings.DimInactiveNamespaces)

	entries := app.AppLogs.logger.GetEntries()
	require.NotEmpty(t, entries)
	last := entries[len(entries)-1]
	require.Equal(t, "INFO", last.Level)
	require.Contains(t, last.Message, "Dim inactive namespaces changed to: false")
}

func TestAppSetExclusiveNamespacesPersists(t *testing.T) {
	setTestConfigEnv(t)
	app := newSettingsEffectsTestFixture(t)

	settings, err := app.Preferences.GetAppSettings()
	require.NoError(t, err)
	require.True(t, settings.ExclusiveNamespaces)

	require.NoError(t, updatePreference(app.Preferences, appPreferenceExclusiveNamespaces, false))
	require.False(t, app.Preferences.appSettings.ExclusiveNamespaces)

	app.Preferences.appSettings = nil
	ensurePreferencesLoaded(t, app.Preferences)
	require.False(t, app.Preferences.appSettings.ExclusiveNamespaces)

	entries := app.AppLogs.logger.GetEntries()
	require.NotEmpty(t, entries)
	last := entries[len(entries)-1]
	require.Equal(t, "INFO", last.Level)
	require.Contains(t, last.Message, "Exclusive namespaces changed to: false")
}

func TestAppSetAutoRefreshEnabledPersists(t *testing.T) {
	setTestConfigEnv(t)
	app := newSettingsEffectsTestFixture(t)

	require.NoError(t, updatePreference(app.Preferences, appPreferenceAutoRefreshEnabled, false))
	require.False(t, app.Preferences.appSettings.AutoRefreshEnabled)

	app.Preferences.appSettings = nil
	ensurePreferencesLoaded(t, app.Preferences)
	require.False(t, app.Preferences.appSettings.AutoRefreshEnabled)

	entries := app.AppLogs.logger.GetEntries()
	require.NotEmpty(t, entries)
	last := entries[len(entries)-1]
	require.Equal(t, "INFO", last.Level)
	require.Contains(t, last.Message, "Auto refresh enabled changed to: false")
}

func TestAppSetBackgroundRefreshEnabledPersists(t *testing.T) {
	setTestConfigEnv(t)
	app := newSettingsEffectsTestFixture(t)

	require.NoError(t, updatePreference(app.Preferences, appPreferenceRefreshBackgroundClustersEnabled, false))
	require.False(t, app.Preferences.appSettings.RefreshBackgroundClustersEnabled)

	app.Preferences.appSettings = nil
	ensurePreferencesLoaded(t, app.Preferences)
	require.False(t, app.Preferences.appSettings.RefreshBackgroundClustersEnabled)

	entries := app.AppLogs.logger.GetEntries()
	require.NotEmpty(t, entries)
	last := entries[len(entries)-1]
	require.Equal(t, "INFO", last.Level)
	require.Contains(t, last.Message, "Background refresh enabled changed to: false")
}

func TestAppSetObjPanelLogsBufferMaxSizePersistsAndClamps(t *testing.T) {
	setTestConfigEnv(t)

	// In-range value round-trips unchanged.
	app := newSettingsEffectsTestFixture(t)
	require.NoError(t, updatePreference(app.Preferences, appPreferenceObjPanelLogsBufferMaxSize, 2500))
	require.Equal(t, 2500, app.Preferences.appSettings.ObjPanelLogsBufferMaxSize)

	app.Preferences.appSettings = nil
	ensurePreferencesLoaded(t, app.Preferences)
	require.Equal(t, 2500, app.Preferences.appSettings.ObjPanelLogsBufferMaxSize)

	entries := app.AppLogs.logger.GetEntries()
	require.NotEmpty(t, entries)
	require.Contains(t, entries[len(entries)-1].Message, "ObjPanelLogs buffer max size changed to: 2500")

	// Out-of-range values clamp to the allowed range.
	require.NoError(t, updatePreference(app.Preferences, appPreferenceObjPanelLogsBufferMaxSize, 50))
	require.Equal(t, minObjPanelLogsBufferMaxSize, app.Preferences.appSettings.ObjPanelLogsBufferMaxSize)

	require.NoError(t, updatePreference(app.Preferences, appPreferenceObjPanelLogsBufferMaxSize, 50000))
	require.Equal(t, maxObjPanelLogsBufferMaxSize, app.Preferences.appSettings.ObjPanelLogsBufferMaxSize)

	// Default is returned when the settings file has no entry yet.
	setTestConfigEnv(t)
	freshApp := newSettingsEffectsTestFixture(t)
	settings, err := freshApp.Preferences.GetAppSettings()
	require.NoError(t, err)
	require.Equal(t, defaultObjPanelLogsBufferMaxSize, settings.ObjPanelLogsBufferMaxSize)
	require.Equal(t, defaultObjPanelLogsTargetPerScopeLimit, settings.ObjPanelLogsTargetPerScopeLimit)
	require.Equal(t, defaultObjPanelLogsTargetGlobalLimit, settings.ObjPanelLogsTargetGlobalLimit)
	require.Equal(t, defaultObjPanelLogsAPITimestampFormat, settings.ObjPanelLogsAPITimestampFormat)
	require.False(t, settings.ObjPanelLogsAPITimestampUseLocalTimeZone)
}

func TestAppRetiredTableRowCapPreferenceIsRejected(t *testing.T) {
	setTestConfigEnv(t)

	app := newSettingsEffectsTestFixture(t)
	_, err := app.Preferences.EnsureLoaded()
	require.NoError(t, err)

	_, err = app.Preferences.UpdateAppPreferences(UpdateAppPreferencesRequest{
		Changes: []AppPreferenceChange{{Key: "max" + "TableRows", Value: 2500}},
	})
	require.Error(t, err)
	require.Contains(t, err.Error(), "unknown preference key")
}

func TestAppSetKubernetesAPISettingsPersistAndClamp(t *testing.T) {
	setTestConfigEnv(t)

	app := newSettingsEffectsTestFixture(t)
	require.NoError(t, updatePreferences(app.Preferences,
		AppPreferenceChange{Key: appPreferenceKubernetesClientQPS, Value: 250},
		AppPreferenceChange{Key: appPreferenceKubernetesClientBurst, Value: 500},
		AppPreferenceChange{Key: appPreferencePermissionSSRRFetchConcurrency, Value: 16},
	))
	require.Equal(t, 250, app.Preferences.appSettings.KubernetesClientQPS)
	require.Equal(t, 500, app.Preferences.appSettings.KubernetesClientBurst)
	require.Equal(t, 16, app.Preferences.appSettings.PermissionSSRRFetchConcurrency)

	app.Preferences.appSettings = nil
	ensurePreferencesLoaded(t, app.Preferences)
	require.Equal(t, 250, app.Preferences.appSettings.KubernetesClientQPS)
	require.Equal(t, 500, app.Preferences.appSettings.KubernetesClientBurst)
	require.Equal(t, 16, app.Preferences.appSettings.PermissionSSRRFetchConcurrency)

	require.NoError(t, updatePreference(app.Preferences, appPreferenceKubernetesClientQPS, 0))
	require.Equal(t, minKubernetesClientQPS, app.Preferences.appSettings.KubernetesClientQPS)
	require.NoError(t, updatePreference(app.Preferences, appPreferenceKubernetesClientQPS, 999_999))
	require.Equal(t, maxKubernetesClientQPS, app.Preferences.appSettings.KubernetesClientQPS)

	require.NoError(t, updatePreference(app.Preferences, appPreferenceKubernetesClientBurst, 0))
	require.Equal(t, minKubernetesClientBurst, app.Preferences.appSettings.KubernetesClientBurst)
	require.NoError(t, updatePreference(app.Preferences, appPreferenceKubernetesClientBurst, 999_999))
	require.Equal(t, maxKubernetesClientBurst, app.Preferences.appSettings.KubernetesClientBurst)

	require.NoError(t, updatePreference(app.Preferences, appPreferencePermissionSSRRFetchConcurrency, 0))
	require.Equal(t, minPermissionSSRRFetchConcurrency, app.Preferences.appSettings.PermissionSSRRFetchConcurrency)
	require.NoError(t, updatePreference(app.Preferences, appPreferencePermissionSSRRFetchConcurrency, 999_999))
	require.Equal(t, maxPermissionSSRRFetchConcurrency, app.Preferences.appSettings.PermissionSSRRFetchConcurrency)

	setTestConfigEnv(t)
	freshApp := newSettingsEffectsTestFixture(t)
	settings, err := freshApp.Preferences.GetAppSettings()
	require.NoError(t, err)
	require.Equal(t, defaultKubernetesClientQPS, settings.KubernetesClientQPS)
	require.Equal(t, defaultKubernetesClientBurst, settings.KubernetesClientBurst)
	require.Equal(t, defaultPermissionSSRRFetchConcurrency, settings.PermissionSSRRFetchConcurrency)
}

func TestAppSetKubernetesClientRateLimitsUpdatesExistingClients(t *testing.T) {
	setTestConfigEnv(t)

	app := newSettingsEffectsTestFixture(t)
	app.ClusterRuntime.kubeAPIMetrics = newKubernetesAPIMetricsRegistry()
	limiter := newMutableKubernetesRateLimiter(defaultKubernetesClientQPS, defaultKubernetesClientBurst)
	app.ClusterRuntime.clusterClients = map[string]*clusterClients{
		"cluster-a": {
			meta:        ClusterMeta{ID: "cluster-a", Name: "Cluster A"},
			rateLimiter: limiter,
			restConfig:  &rest.Config{QPS: float32(defaultKubernetesClientQPS), Burst: defaultKubernetesClientBurst},
		},
	}
	app.ClusterRuntime.kubeAPIMetrics.getOrCreate(ClusterMeta{ID: "cluster-a", Name: "Cluster A"}, defaultKubernetesClientQPS, defaultKubernetesClientBurst)

	require.NoError(t, updatePreference(app.Preferences, appPreferenceKubernetesClientQPS, 150))
	qps, burst := limiter.Limits()
	require.Equal(t, 150, qps)
	require.Equal(t, defaultKubernetesClientBurst, burst)
	require.Equal(t, float32(150), app.ClusterRuntime.clusterClients["cluster-a"].restConfig.QPS)
	require.Equal(t, defaultKubernetesClientBurst, app.ClusterRuntime.clusterClients["cluster-a"].restConfig.Burst)

	require.NoError(t, updatePreference(app.Preferences, appPreferenceKubernetesClientBurst, 450))
	qps, burst = limiter.Limits()
	require.Equal(t, 150, qps)
	require.Equal(t, 450, burst)
	require.Equal(t, float32(150), app.ClusterRuntime.clusterClients["cluster-a"].restConfig.QPS)
	require.Equal(t, 450, app.ClusterRuntime.clusterClients["cluster-a"].restConfig.Burst)

	rows := app.ClusterRuntime.kubeAPIMetrics.snapshot(time.Now())
	require.Len(t, rows, 1)
	require.Equal(t, 150, rows[0].ConfiguredQPS)
	require.Equal(t, 450, rows[0].ConfiguredBurst)
}

func TestAppSetObjPanelLogsTargetPerScopeLimitPersistsAndClamps(t *testing.T) {
	setTestConfigEnv(t)

	app := newSettingsEffectsTestFixture(t)
	require.NoError(t, updatePreference(app.Preferences, appPreferenceObjPanelLogsTargetPerScopeLimit, 144))
	require.Equal(t, 144, app.Preferences.appSettings.ObjPanelLogsTargetPerScopeLimit)

	app.Preferences.appSettings = nil
	ensurePreferencesLoaded(t, app.Preferences)
	require.Equal(t, 144, app.Preferences.appSettings.ObjPanelLogsTargetPerScopeLimit)

	entries := app.AppLogs.logger.GetEntries()
	require.NotEmpty(t, entries)
	require.Contains(t, entries[len(entries)-1].Message, "Object Panel Logs Tab target per-scope limit changed to: 144")

	require.NoError(t, updatePreference(app.Preferences, appPreferenceObjPanelLogsTargetPerScopeLimit, 0))
	require.Equal(t, minObjPanelLogsTargetPerScopeLimit, app.Preferences.appSettings.ObjPanelLogsTargetPerScopeLimit)

	require.NoError(t, updatePreference(app.Preferences, appPreferenceObjPanelLogsTargetPerScopeLimit, 999_999))
	require.Equal(t, maxObjPanelLogsTargetPerScopeLimit, app.Preferences.appSettings.ObjPanelLogsTargetPerScopeLimit)
}

func TestAppSetObjPanelLogsTargetGlobalLimitPersistsAndClamps(t *testing.T) {
	setTestConfigEnv(t)

	app := newSettingsEffectsTestFixture(t)
	require.NoError(t, updatePreference(app.Preferences, appPreferenceObjPanelLogsTargetGlobalLimit, 180))
	require.Equal(t, 180, app.Preferences.appSettings.ObjPanelLogsTargetGlobalLimit)

	app.Preferences.appSettings = nil
	ensurePreferencesLoaded(t, app.Preferences)
	require.Equal(t, 180, app.Preferences.appSettings.ObjPanelLogsTargetGlobalLimit)

	entries := app.AppLogs.logger.GetEntries()
	require.NotEmpty(t, entries)
	require.Contains(t, entries[len(entries)-1].Message, "Object Panel Logs Tab target global limit changed to: 180")

	require.NoError(t, updatePreference(app.Preferences, appPreferenceObjPanelLogsTargetGlobalLimit, 0))
	require.Equal(t, minObjPanelLogsTargetGlobalLimit, app.Preferences.appSettings.ObjPanelLogsTargetGlobalLimit)

	require.NoError(t, updatePreference(app.Preferences, appPreferenceObjPanelLogsTargetGlobalLimit, 999_999))
	require.Equal(t, maxObjPanelLogsTargetGlobalLimit, app.Preferences.appSettings.ObjPanelLogsTargetGlobalLimit)
}

func TestAppSetObjPanelLogsAPITimestampFormatPersists(t *testing.T) {
	setTestConfigEnv(t)

	app := newSettingsEffectsTestFixture(t)
	require.NoError(t, updatePreference(app.Preferences, appPreferenceObjPanelLogsAPITimestampFormat, "HH:mm:ss.SSS"))
	require.Equal(t, "HH:mm:ss.SSS", app.Preferences.appSettings.ObjPanelLogsAPITimestampFormat)

	app.Preferences.appSettings = nil
	ensurePreferencesLoaded(t, app.Preferences)
	require.Equal(t, "HH:mm:ss.SSS", app.Preferences.appSettings.ObjPanelLogsAPITimestampFormat)

	entries := app.AppLogs.logger.GetEntries()
	require.NotEmpty(t, entries)
	require.Contains(t, entries[len(entries)-1].Message, "Object Panel Logs Tab API timestamp format changed to: HH:mm:ss.SSS")

	require.NoError(t, updatePreference(app.Preferences, appPreferenceObjPanelLogsAPITimestampFormat, ""))
	require.Equal(t, defaultObjPanelLogsAPITimestampFormat, app.Preferences.appSettings.ObjPanelLogsAPITimestampFormat)
}

func TestAppSetObjPanelLogsAPITimestampUseLocalTimeZonePersists(t *testing.T) {
	setTestConfigEnv(t)

	app := newSettingsEffectsTestFixture(t)
	require.NoError(t, updatePreference(app.Preferences, appPreferenceObjPanelLogsAPITimestampUseLocalTimeZone, true))
	require.True(t, app.Preferences.appSettings.ObjPanelLogsAPITimestampUseLocalTimeZone)

	app.Preferences.appSettings = nil
	ensurePreferencesLoaded(t, app.Preferences)
	require.True(t, app.Preferences.appSettings.ObjPanelLogsAPITimestampUseLocalTimeZone)

	entries := app.AppLogs.logger.GetEntries()
	require.NotEmpty(t, entries)
	require.Contains(
		t,
		entries[len(entries)-1].Message,
		"Object Panel Logs Tab API timestamp local timezone changed to: true",
	)
}

func TestAppSetGridTablePersistenceModePersists(t *testing.T) {
	setTestConfigEnv(t)
	app := newSettingsEffectsTestFixture(t)

	require.NoError(t, updatePreference(app.Preferences, appPreferenceGridTablePersistenceMode, "namespaced"))
	require.Equal(t, "namespaced", app.Preferences.appSettings.GridTablePersistenceMode)

	app.Preferences.appSettings = nil
	ensurePreferencesLoaded(t, app.Preferences)
	require.Equal(t, "namespaced", app.Preferences.appSettings.GridTablePersistenceMode)

	entries := app.AppLogs.logger.GetEntries()
	require.NotEmpty(t, entries)
	last := entries[len(entries)-1]
	require.Equal(t, "INFO", last.Level)
	require.Contains(t, last.Message, "Grid table persistence mode changed to: namespaced")
}

func TestAppSetGridTablePersistenceModeRejectsInvalidValues(t *testing.T) {
	setTestConfigEnv(t)
	app := newSettingsEffectsTestFixture(t)

	err := updatePreference(app.Preferences, appPreferenceGridTablePersistenceMode, "invalid")
	require.Error(t, err)
	require.Contains(t, err.Error(), "invalid grid table persistence mode")
}

func TestAppSetDefaultObjectPanelPositionPersists(t *testing.T) {
	setTestConfigEnv(t)
	app := newSettingsEffectsTestFixture(t)

	require.NoError(t, updatePreference(app.Preferences, appPreferenceDefaultObjectPanelPosition, "bottom"))
	require.Equal(t, "bottom", app.Preferences.appSettings.DefaultObjectPanelPosition)

	app.Preferences.appSettings = nil
	ensurePreferencesLoaded(t, app.Preferences)
	require.Equal(t, "bottom", app.Preferences.appSettings.DefaultObjectPanelPosition)

	entries := app.AppLogs.logger.GetEntries()
	require.NotEmpty(t, entries)
	last := entries[len(entries)-1]
	require.Contains(t, last.Message, "Default object panel position changed to: bottom")
}

func TestAppSetDefaultObjectPanelPositionRejectsInvalidValues(t *testing.T) {
	setTestConfigEnv(t)
	app := newSettingsEffectsTestFixture(t)

	err := updatePreference(app.Preferences, appPreferenceDefaultObjectPanelPosition, "invalid")
	require.Error(t, err)
	require.Contains(t, err.Error(), "invalid default object panel position")
}

func TestAppGetAppearanceModeInfoReflectsCurrentSettings(t *testing.T) {
	setTestConfigEnv(t)
	app := newSettingsEffectsTestFixture(t)

	require.NoError(t, updatePreference(app.Preferences, appPreferenceAppearanceMode, "light"))
	info, err := app.Preferences.GetAppSettings()
	require.NoError(t, err)
	require.Equal(t, "light", info.AppearanceMode)
}

func TestAppShowSettingsWarnsWhenContextNil(t *testing.T) {
	setTestConfigEnv(t)
	app := newSettingsEffectsTestFixture(t)

	app.DesktopShell.ShowSettings()

	entries := app.AppLogs.logger.GetEntries()
	require.NotEmpty(t, entries)
	last := entries[len(entries)-1]
	require.Equal(t, "WARN", last.Level)
	require.Contains(t, last.Message, "Cannot show settings")
}

func TestAppShowAboutWarnsWhenContextNil(t *testing.T) {
	setTestConfigEnv(t)
	app := newSettingsEffectsTestFixture(t)

	app.DesktopShell.ShowAbout()

	entries := app.AppLogs.logger.GetEntries()
	require.NotEmpty(t, entries)
	last := entries[len(entries)-1]
	require.Equal(t, "WARN", last.Level)
	require.Contains(t, last.Message, "Cannot show about")
}

func TestLoadSettingsFileNormalizesDefaults(t *testing.T) {
	// Ensure missing/zero fields are normalized to defaults after load.
	setTestConfigEnv(t)
	app := newSettingsEffectsTestFixture(t)

	configPath, err := app.Preferences.getSettingsFilePath()
	require.NoError(t, err)

	writeTestFileWithParents(t, configPath, []byte(`{"schemaVersion":0}`), 0o644)

	settings, err := app.Preferences.loadSettingsFile()
	require.NoError(t, err)
	require.Equal(t, settingsSchemaVersion, settings.SchemaVersion)
	require.Equal(t, "system", settings.Preferences.AppearanceMode)
	require.NotNil(t, settings.Preferences.Refresh)
	require.True(t, settings.Preferences.Refresh.Auto)
	require.True(t, settings.Preferences.Refresh.Background)
	require.Equal(t, "shared", settings.Preferences.GridTablePersistenceMode)
	require.Equal(t, defaultObjectPanelPosition, settings.Preferences.DefaultObjectPanelPosition)
	require.Equal(t, defaultObjectPanelDockedRightWidth, settings.Preferences.ObjectPanelDockedRightWidth)
	require.Equal(t, defaultObjectPanelDockedBottomHeight, settings.Preferences.ObjectPanelDockedBottomHeight)
	require.Equal(t, defaultObjectPanelFloatingWidth, settings.Preferences.ObjectPanelFloatingWidth)
	require.Equal(t, defaultObjectPanelFloatingHeight, settings.Preferences.ObjectPanelFloatingHeight)
	require.Equal(t, defaultObjectPanelFloatingX, settings.Preferences.ObjectPanelFloatingX)
	require.Equal(t, defaultObjectPanelFloatingY, settings.Preferences.ObjectPanelFloatingY)
	require.Equal(t, defaultKubeconfigSearchPaths(), settings.Kubeconfig.SearchPaths)
}

func TestNormalizeSettingsFileIsIdempotentAndPreservesExplicitValues(t *testing.T) {
	falseValue := false
	settings := &settingsFile{
		Preferences: settingsPreferences{
			AppearanceMode:        "dark",
			DimInactiveNamespaces: &falseValue,
			ExclusiveNamespaces:   &falseValue,
			ErrorReportingEnabled: &falseValue,
			Refresh: &settingsRefresh{
				MetricsIntervalMs: 1234,
			},
			KubernetesAPI: &settingsKubernetesAPI{
				ClientQPS:                      maxKubernetesClientQPS + 1,
				ClientBurst:                    maxKubernetesClientBurst + 1,
				PermissionSSRRFetchConcurrency: maxPermissionSSRRFetchConcurrency + 1,
			},
			ObjPanelLogs: &settingsObjPanelLogs{
				BufferMaxSize:       maxObjPanelLogsBufferMaxSize + 1,
				TargetPerScopeLimit: maxObjPanelLogsTargetPerScopeLimit + 1,
				TargetGlobalLimit:   maxObjPanelLogsTargetGlobalLimit + 1,
				APITimestampFormat:  "HH:mm:ss",
			},
			GridTablePersistenceMode:      "per-cluster",
			DefaultTablePageSize:          maxTablePageSize + 1,
			DefaultObjectPanelPosition:    "bottom",
			ObjectPanelDockedRightWidth:   maxObjectPanelLayoutValue + 1,
			ObjectPanelDockedBottomHeight: maxObjectPanelLayoutValue + 1,
			ObjectPanelFloatingWidth:      maxObjectPanelLayoutValue + 1,
			ObjectPanelFloatingHeight:     maxObjectPanelLayoutValue + 1,
			ObjectPanelFloatingX:          maxObjectPanelLayoutValue + 1,
			ObjectPanelFloatingY:          maxObjectPanelLayoutValue + 1,
			PaletteHue:                    175,
			PaletteSaturation:             65,
			PaletteBrightness:             -10,
			Themes: []Theme{
				{ID: "custom", Name: "Custom"},
				{ID: defaultThemeID, Name: "Legacy default", ClusterPattern: "ignored"},
				{ID: defaultThemeID, Name: "Duplicate default"},
			},
		},
	}

	got := normalizeSettingsFile(settings)
	require.Same(t, settings, got)
	require.False(t, *got.Preferences.DimInactiveNamespaces)
	require.False(t, *got.Preferences.ExclusiveNamespaces)
	require.False(t, *got.Preferences.ErrorReportingEnabled)
	require.Equal(t, maxKubernetesClientQPS, got.Preferences.KubernetesAPI.ClientQPS)
	require.Equal(t, maxKubernetesClientBurst, got.Preferences.KubernetesAPI.ClientBurst)
	require.Equal(t, maxPermissionSSRRFetchConcurrency, got.Preferences.KubernetesAPI.PermissionSSRRFetchConcurrency)
	require.Equal(t, maxObjPanelLogsBufferMaxSize, got.Preferences.ObjPanelLogs.BufferMaxSize)
	require.Equal(t, maxObjPanelLogsTargetPerScopeLimit, got.Preferences.ObjPanelLogs.TargetPerScopeLimit)
	require.Equal(t, maxObjPanelLogsTargetGlobalLimit, got.Preferences.ObjPanelLogs.TargetGlobalLimit)
	require.Equal(t, maxTablePageSize, got.Preferences.DefaultTablePageSize)
	require.Equal(t, maxObjectPanelLayoutValue, got.Preferences.ObjectPanelDockedRightWidth)
	require.Equal(t, maxObjectPanelLayoutValue, got.Preferences.ObjectPanelFloatingY)
	require.Equal(t, 175, got.Preferences.PaletteHueLight)
	require.Equal(t, 175, got.Preferences.PaletteHueDark)
	require.Zero(t, got.Preferences.PaletteHue)
	require.Equal(t, defaultKubeconfigSearchPaths(), got.Kubeconfig.SearchPaths)
	require.Equal(t, []string{"custom", defaultThemeID}, []string{got.Preferences.Themes[0].ID, got.Preferences.Themes[1].ID})
	require.Equal(t, defaultThemeName, got.Preferences.Themes[1].Name)
	require.Empty(t, got.Preferences.Themes[1].ClusterPattern)

	once, err := json.Marshal(got)
	require.NoError(t, err)
	require.Same(t, got, normalizeSettingsFile(got))
	twice, err := json.Marshal(got)
	require.NoError(t, err)
	require.JSONEq(t, string(once), string(twice))
}

func TestNormalizeSettingsFileCompletesZeroValueDefaults(t *testing.T) {
	settings := normalizeSettingsFile(&settingsFile{})

	require.Equal(t, settingsSchemaVersion, settings.SchemaVersion)
	require.Equal(t, "system", settings.Preferences.AppearanceMode)
	require.True(t, *settings.Preferences.DimInactiveNamespaces)
	require.True(t, *settings.Preferences.ExclusiveNamespaces)
	require.True(t, *settings.Preferences.ErrorReportingEnabled)
	require.Equal(t, &settingsRefresh{Auto: true, Background: true, MetricsIntervalMs: defaultMetricsIntervalMs()}, settings.Preferences.Refresh)
	require.Equal(t, &settingsKubernetesAPI{
		ClientQPS:                      defaultKubernetesClientQPS,
		ClientBurst:                    defaultKubernetesClientBurst,
		PermissionSSRRFetchConcurrency: defaultPermissionSSRRFetchConcurrency,
	}, settings.Preferences.KubernetesAPI)
	require.Equal(t, &settingsObjPanelLogs{
		BufferMaxSize:       defaultObjPanelLogsBufferMaxSize,
		TargetPerScopeLimit: defaultObjPanelLogsTargetPerScopeLimit,
		TargetGlobalLimit:   defaultObjPanelLogsTargetGlobalLimit,
		APITimestampFormat:  defaultObjPanelLogsAPITimestampFormat,
	}, settings.Preferences.ObjPanelLogs)
	require.Equal(t, defaultTablePageSize, settings.Preferences.DefaultTablePageSize)
	require.Equal(t, []Theme{defaultTheme()}, settings.Preferences.Themes)
	require.Equal(t, defaultKubeconfigSearchPaths(), settings.Kubeconfig.SearchPaths)
}

func TestNormalizeSettingsFileCompletesPartiallyPresentNestedDefaults(t *testing.T) {
	settings := normalizeSettingsFile(&settingsFile{Preferences: settingsPreferences{
		Refresh:      &settingsRefresh{},
		ObjPanelLogs: &settingsObjPanelLogs{},
	}})

	require.Equal(t, defaultMetricsIntervalMs(), settings.Preferences.Refresh.MetricsIntervalMs)
	require.Equal(t, defaultObjPanelLogsAPITimestampFormat, settings.Preferences.ObjPanelLogs.APITimestampFormat)
}

func TestNormalizeSettingsFileNilUsesCompleteDefaults(t *testing.T) {
	settings := normalizeSettingsFile(nil)

	require.NotNil(t, settings)
	require.Equal(t, settingsSchemaVersion, settings.SchemaVersion)
	require.NotNil(t, settings.Preferences.Refresh)
	require.NotNil(t, settings.Preferences.KubernetesAPI)
	require.NotNil(t, settings.Preferences.ObjPanelLogs)
	require.Equal(t, []Theme{defaultTheme()}, settings.Preferences.Themes)
}

func TestAppGetAppSettingsSchemaIncludesBackendOwnedDefaults(t *testing.T) {
	setTestConfigEnv(t)
	app := newSettingsEffectsTestFixture(t)

	schema, err := app.Preferences.GetAppSettingsSchema()
	require.NoError(t, err)

	byKey := make(map[string]AppPreferenceSchema, len(schema.Preferences))
	for _, pref := range schema.Preferences {
		byKey[pref.Key] = pref
	}

	require.Equal(t, "enum", byKey[appPreferenceAppearanceMode].Type)
	require.Equal(t, []string{"light", "dark", "system"}, byKey[appPreferenceAppearanceMode].EnumOptions)
	require.True(t, byKey[appPreferenceAppearanceMode].RuntimeSideEffect)
	require.Equal(t, defaultObjectPanelPosition, byKey[appPreferenceDefaultObjectPanelPosition].DefaultValue)
	require.Equal(t, defaultObjectPanelPosition, byKey[appPreferenceDefaultObjectPanelPosition].CurrentValue)
	require.Equal(t, defaultObjectPanelDockedRightWidth, byKey[appPreferenceObjectPanelDockedRightWidth].DefaultValue)
	require.Equal(t, defaultKubernetesClientQPS, byKey[appPreferenceKubernetesClientQPS].DefaultValue)
	require.Equal(t, minKubernetesClientQPS, *byKey[appPreferenceKubernetesClientQPS].Min)
	require.Equal(t, maxKubernetesClientQPS, *byKey[appPreferenceKubernetesClientQPS].Max)
	require.Equal(t, minObjectPanelDockedRightWidth, *byKey[appPreferenceObjectPanelDockedRightWidth].Min)
	require.Equal(t, maxObjectPanelLayoutValue, *byKey[appPreferenceObjectPanelDockedRightWidth].Max)
	require.Equal(t, minObjectPanelFloatingX, *byKey[appPreferenceObjectPanelFloatingX].Min)
	require.Equal(t, maxObjectPanelLayoutValue, *byKey[appPreferenceObjectPanelFloatingX].Max)
}

func TestAppSettingsSchemaCoversUpdateAppPreferenceKeys(t *testing.T) {
	setTestConfigEnv(t)
	app := newSettingsEffectsTestFixture(t)

	schema, err := app.Preferences.GetAppSettingsSchema()
	require.NoError(t, err)

	schemaKeys := make([]string, 0, len(schema.Preferences))
	seen := make(map[string]struct{}, len(schema.Preferences))
	for _, pref := range schema.Preferences {
		require.NotEmpty(t, pref.Key)
		require.NotEmpty(t, pref.Type)
		require.NotContains(t, seen, pref.Key, "duplicate schema key %q", pref.Key)
		seen[pref.Key] = struct{}{}
		schemaKeys = append(schemaKeys, pref.Key)
	}

	require.ElementsMatch(t, appPreferenceKeys(), schemaKeys)
}

func TestAppUpdateAppPreferencesAppliesAtomicBatch(t *testing.T) {
	setTestConfigEnv(t)
	app := newSettingsEffectsTestFixture(t)
	app.ClusterRuntime.kubeAPIMetrics = newKubernetesAPIMetricsRegistry()
	limiter := newMutableKubernetesRateLimiter(defaultKubernetesClientQPS, defaultKubernetesClientBurst)
	app.ClusterRuntime.clusterClients = map[string]*clusterClients{
		"cluster-a": {
			meta:        ClusterMeta{ID: "cluster-a", Name: "Cluster A"},
			rateLimiter: limiter,
			restConfig:  &rest.Config{QPS: float32(defaultKubernetesClientQPS), Burst: defaultKubernetesClientBurst},
		},
	}

	response, err := app.Preferences.UpdateAppPreferences(UpdateAppPreferencesRequest{Changes: []AppPreferenceChange{
		{Key: appPreferenceAppearanceMode, Value: "dark"},
		{Key: appPreferenceKubernetesClientQPS, Value: 150},
		{Key: appPreferenceKubernetesClientBurst, Value: 450},
		{Key: appPreferenceObjPanelLogsTargetPerScopeLimit, Value: 144},
		{Key: appPreferenceDefaultObjectPanelPosition, Value: "bottom"},
	}})
	require.NoError(t, err)
	require.Equal(t, []string{
		appPreferenceAppearanceMode,
		appPreferenceKubernetesClientQPS,
		appPreferenceKubernetesClientBurst,
		appPreferenceObjPanelLogsTargetPerScopeLimit,
		appPreferenceDefaultObjectPanelPosition,
	}, response.ChangedKeys)
	require.Equal(t, "dark", response.Settings.AppearanceMode)
	require.Equal(t, 150, response.Settings.KubernetesClientQPS)
	require.Equal(t, 450, response.Settings.KubernetesClientBurst)
	require.Equal(t, 144, app.ContainerLogsPolicy.Limit())
	require.Equal(t, "bottom", response.Settings.DefaultObjectPanelPosition)

	qps, burst := limiter.Limits()
	require.Equal(t, 150, qps)
	require.Equal(t, 450, burst)

	app.Preferences.appSettings = nil
	ensurePreferencesLoaded(t, app.Preferences)
	require.Equal(t, "dark", app.Preferences.appSettings.AppearanceMode)
	require.Equal(t, 150, app.Preferences.appSettings.KubernetesClientQPS)
	require.Equal(t, 450, app.Preferences.appSettings.KubernetesClientBurst)
	require.Equal(t, "bottom", app.Preferences.appSettings.DefaultObjectPanelPosition)
}

func TestAppUpdateAppPreferencesRejectsInvalidBatchWithoutMutation(t *testing.T) {
	setTestConfigEnv(t)
	app := newSettingsEffectsTestFixture(t)
	require.NoError(t, updatePreference(app.Preferences, appPreferenceAppearanceMode, "light"))

	_, err := app.Preferences.UpdateAppPreferences(UpdateAppPreferencesRequest{Changes: []AppPreferenceChange{
		{Key: appPreferenceAppearanceMode, Value: "dark"},
		{Key: appPreferenceGridTablePersistenceMode, Value: "invalid"},
	}})
	require.Error(t, err)
	require.Contains(t, err.Error(), "invalid grid table persistence mode")
	require.Equal(t, "light", app.Preferences.appSettings.AppearanceMode)

	app.Preferences.appSettings = nil
	ensurePreferencesLoaded(t, app.Preferences)
	require.Equal(t, "light", app.Preferences.appSettings.AppearanceMode)
}

func TestAppUpdateAppPreferencesDoesNotApplySideEffectsWhenPersistenceFails(t *testing.T) {
	setTestConfigEnv(t)
	app := newSettingsEffectsTestFixture(t)
	app.ContainerLogsPolicy.SetContainerLogsPerScopeLimit(defaultObjPanelLogsTargetPerScopeLimit)
	require.NoError(t, updatePreference(app.Preferences, appPreferenceObjPanelLogsTargetPerScopeLimit, 144))
	require.Equal(t, 144, app.ContainerLogsPolicy.Limit())

	originalWrite := writeSettingsFileAtomic
	t.Cleanup(func() {
		writeSettingsFileAtomic = originalWrite
		app.ContainerLogsPolicy.SetContainerLogsPerScopeLimit(defaultObjPanelLogsTargetPerScopeLimit)
	})
	writeSettingsFileAtomic = func(string, []byte, os.FileMode) error {
		return errors.New("forced write failure")
	}

	_, err := app.Preferences.UpdateAppPreferences(UpdateAppPreferencesRequest{Changes: []AppPreferenceChange{
		{Key: appPreferenceObjPanelLogsTargetPerScopeLimit, Value: 222},
	}})
	require.Error(t, err)
	require.Contains(t, err.Error(), "forced write failure")
	require.Equal(t, 144, app.Preferences.appSettings.ObjPanelLogsTargetPerScopeLimit)
	require.Equal(t, 144, app.ContainerLogsPolicy.Limit())
}

func TestSettingsEffectDispatcherAllowsMissingReporter(t *testing.T) {
	app := newSettingsEffectsTestFixture(t)
	settings := getDefaultAppSettings()
	settings.ErrorReportingEnabled = true

	require.NotPanics(t, func() {
		app.Preferences.effects.Dispatch(settings, settingsSideEffects{errorReporting: true})
	})
}

func TestApplyContainerLogsGlobalLimitSideEffectAllowsMissingLimiter(t *testing.T) {
	var refreshCoordinator *RefreshCoordinator
	require.NotPanics(t, func() {
		refreshCoordinator.SetContainerLogsGlobalLimit(2)
	})
}

func TestSettingsEffectDispatcherDoesNotScheduleRegistrationAfterReporterFailure(t *testing.T) {
	setTestConfigEnv(t)
	reporter := &failingSettingsReporter{
		recordingInstallationReporter: newRecordingInstallationReporter(true),
		err:                           errors.New("forced reporter failure"),
	}
	app := newSettingsEffectsTestFixture(t, reporter)
	setTestAppRuntimeReady(t, app.Lifecycle, context.Background())
	settings := getDefaultAppSettings()
	settings.ErrorReportingEnabled = true

	app.Preferences.effects.Dispatch(settings, settingsSideEffects{errorReporting: true})

	require.Never(t, func() bool {
		reporter.metricMu.Lock()
		defer reporter.metricMu.Unlock()
		return len(reporter.metrics) > 0
	}, 100*time.Millisecond, 10*time.Millisecond)
	entries := app.AppLogs.logger.GetEntries()
	require.NotEmpty(t, entries)
	require.Contains(t, entries[len(entries)-1].Message, "Could not update error reporting: forced reporter failure")
}

func TestSettingsEffectDispatcherRetimesEveryConnectedCluster(t *testing.T) {
	app := newSettingsEffectsTestFixture(t)
	first := &settingsMetricsPoller{}
	second := &settingsMetricsPoller{}
	app.Refresh.refreshSubsystems = map[string]*system.Subsystem{
		"cluster-a": {Manager: refresh.NewManager(nil, nil, nil, first, nil)},
		"cluster-b": {Manager: refresh.NewManager(nil, nil, nil, second, nil)},
		"cluster-c": nil,
		"cluster-d": {},
	}
	settings := getDefaultAppSettings()
	settings.MetricsRefreshIntervalMs = 4321

	app.Preferences.effects.Dispatch(settings, settingsSideEffects{metricsInterval: true})

	want := []time.Duration{4321 * time.Millisecond}
	require.Equal(t, want, first.recordedIntervals())
	require.Equal(t, want, second.recordedIntervals())
}

func TestSettingsEffectDispatcherAppliesAllSixRoutes(t *testing.T) {
	setTestConfigEnv(t)
	reporter := &recordingErrorReporter{}
	app := newSettingsEffectsTestFixture(t)
	app.ErrorReporting.reporter = reporter
	app.ClusterRuntime.kubeAPIMetrics = newKubernetesAPIMetricsRegistry()
	rateLimiter := newMutableKubernetesRateLimiter(defaultKubernetesClientQPS, defaultKubernetesClientBurst)
	app.ClusterRuntime.clusterClients = map[string]*clusterClients{
		"cluster-a": {
			meta:        ClusterMeta{ID: "cluster-a", Name: "Cluster A"},
			rateLimiter: rateLimiter,
			restConfig:  &rest.Config{QPS: float32(defaultKubernetesClientQPS), Burst: defaultKubernetesClientBurst},
		},
	}
	metricsPoller := &settingsMetricsPoller{}
	app.Refresh.refreshSubsystems = map[string]*system.Subsystem{
		"cluster-a": {Manager: refresh.NewManager(nil, nil, nil, metricsPoller, nil)},
	}
	require.NotNil(t, app.Refresh.containerLogsTargetLimiter)
	initialSession := app.Refresh.containerLogsTargetLimiter.StartSession("cluster-a", "initial-default")
	initialTargets := make([]string, defaultObjPanelLogsTargetGlobalLimit+1)
	for index := range initialTargets {
		initialTargets[index] = fmt.Sprintf("target-%d", index)
	}
	allowed, skipped := initialSession.UpdateDesired(initialTargets)
	require.Len(t, allowed, defaultObjPanelLogsTargetGlobalLimit)
	require.Equal(t, 1, skipped)
	initialSession.Release()

	settings := getDefaultAppSettings()
	settings.ErrorReportingEnabled = false
	settings.KubernetesClientQPS = 111
	settings.KubernetesClientBurst = 333
	settings.PermissionSSRRFetchConcurrency = 17
	settings.ObjPanelLogsTargetPerScopeLimit = 77
	settings.ObjPanelLogsTargetGlobalLimit = 2
	settings.MetricsRefreshIntervalMs = 6789
	app.Preferences.effects.Dispatch(settings, settingsSideEffects{
		errorReporting:             true,
		kubernetesClientRateLimits: true,
		permissionFetchConcurrency: true,
		containerLogsPerScopeLimit: true,
		containerLogsGlobalLimit:   true,
		metricsInterval:            true,
	})

	reporter.mu.Lock()
	require.Equal(t, []bool{false}, reporter.enabledChanges)
	reporter.mu.Unlock()
	qps, burst := rateLimiter.Limits()
	require.Equal(t, 111, qps)
	require.Equal(t, 333, burst)
	require.Equal(t, 17, app.PermissionFetchPolicy.Concurrency())
	require.Equal(t, 77, app.ContainerLogsPolicy.Limit())
	require.Equal(t, []time.Duration{6789 * time.Millisecond}, metricsPoller.recordedIntervals())

	require.NotNil(t, app.Refresh.containerLogsTargetLimiter)
	session := app.Refresh.containerLogsTargetLimiter.StartSession("cluster-a", "scope-a")
	defer session.Release()
	allowed, skipped = session.UpdateDesired([]string{"a", "b", "c"})
	require.Len(t, allowed, 2)
	require.Equal(t, 1, skipped)
}

func TestLoadSettingsFileMigratesOldAppearanceModePreference(t *testing.T) {
	setTestConfigEnv(t)
	app := newSettingsEffectsTestFixture(t)

	configPath, err := app.Preferences.getSettingsFilePath()
	require.NoError(t, err)
	writeTestFileWithParents(t, configPath, []byte(`{"schemaVersion":1,"preferences":{"theme":"dark"}}`), 0o644)

	settings, err := app.Preferences.loadSettingsFile()
	require.NoError(t, err)
	require.Equal(t, "dark", settings.Preferences.AppearanceMode)

	require.NoError(t, app.Preferences.saveSettingsFile(settings))
	saved, err := os.ReadFile(configPath)
	require.NoError(t, err)
	require.Contains(t, string(saved), `"appearanceMode":"dark"`)
	require.NotContains(t, string(saved), `"theme":"dark"`)
}

func TestSaveSettingsFileOverwritesExistingData(t *testing.T) {
	// Verify subsequent saves overwrite previous settings on disk.
	setTestConfigEnv(t)
	app := newSettingsEffectsTestFixture(t)

	settings, err := app.Preferences.loadSettingsFile()
	require.NoError(t, err)

	settings.Preferences.AppearanceMode = "dark"
	require.NoError(t, app.Preferences.saveSettingsFile(settings))

	settings.Preferences.AppearanceMode = "light"
	require.NoError(t, app.Preferences.saveSettingsFile(settings))

	loaded, err := app.Preferences.loadSettingsFile()
	require.NoError(t, err)
	require.Equal(t, "light", loaded.Preferences.AppearanceMode)
}

func TestWriteFileAtomicPreservesExistingFileWhenReplacementFails(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "settings.json")
	require.NoError(t, os.WriteFile(path, []byte("saved-state"), 0o644))

	err := writeFileAtomicWithReplace(
		path,
		[]byte("default-state"),
		0o644,
		func(string, string) error {
			return errors.New("forced replace failure")
		},
	)
	require.ErrorContains(t, err, "forced replace failure")

	data, readErr := os.ReadFile(path)
	require.NoError(t, readErr)
	require.Equal(t, "saved-state", string(data))
}

func TestAppSetPaletteTintPersistsAndClamps(t *testing.T) {
	setTestConfigEnv(t)
	app := newSettingsEffectsTestFixture(t)

	// Normal values persist correctly for light mode.
	require.NoError(t, updatePreferences(app.Preferences,
		AppPreferenceChange{Key: appPreferencePaletteHueLight, Value: 220},
		AppPreferenceChange{Key: appPreferencePaletteSaturationLight, Value: 50},
		AppPreferenceChange{Key: appPreferencePaletteBrightnessLight, Value: -15},
	))
	require.Equal(t, 220, app.Preferences.appSettings.PaletteHueLight)
	require.Equal(t, 50, app.Preferences.appSettings.PaletteSaturationLight)
	require.Equal(t, -15, app.Preferences.appSettings.PaletteBrightnessLight)
	// Dark mode remains untouched.
	require.Equal(t, 0, app.Preferences.appSettings.PaletteHueDark)
	require.Equal(t, 0, app.Preferences.appSettings.PaletteSaturationDark)
	require.Equal(t, 0, app.Preferences.appSettings.PaletteBrightnessDark)

	// Round-trips through save/load.
	app.Preferences.appSettings = nil
	ensurePreferencesLoaded(t, app.Preferences)
	require.Equal(t, 220, app.Preferences.appSettings.PaletteHueLight)
	require.Equal(t, 50, app.Preferences.appSettings.PaletteSaturationLight)
	require.Equal(t, -15, app.Preferences.appSettings.PaletteBrightnessLight)

	// Logs the change.
	entries := app.AppLogs.logger.GetEntries()
	require.NotEmpty(t, entries)
	last := entries[len(entries)-1]
	require.Equal(t, "INFO", last.Level)
	require.Contains(t, last.Message, "Palette brightness light changed to: -15")
}

func TestAppSetPaletteTintClampsOutOfRange(t *testing.T) {
	setTestConfigEnv(t)
	app := newSettingsEffectsTestFixture(t)

	// Values above max are clamped (light mode).
	require.NoError(t, updatePreferences(app.Preferences,
		AppPreferenceChange{Key: appPreferencePaletteHueLight, Value: 400},
		AppPreferenceChange{Key: appPreferencePaletteSaturationLight, Value: 150},
		AppPreferenceChange{Key: appPreferencePaletteBrightnessLight, Value: 80},
	))
	require.Equal(t, 360, app.Preferences.appSettings.PaletteHueLight)
	require.Equal(t, 100, app.Preferences.appSettings.PaletteSaturationLight)
	require.Equal(t, 50, app.Preferences.appSettings.PaletteBrightnessLight)

	// Values below min are clamped (dark mode).
	require.NoError(t, updatePreferences(app.Preferences,
		AppPreferenceChange{Key: appPreferencePaletteHueDark, Value: -10},
		AppPreferenceChange{Key: appPreferencePaletteSaturationDark, Value: -5},
		AppPreferenceChange{Key: appPreferencePaletteBrightnessDark, Value: -100},
	))
	require.Equal(t, 0, app.Preferences.appSettings.PaletteHueDark)
	require.Equal(t, 0, app.Preferences.appSettings.PaletteSaturationDark)
	require.Equal(t, -50, app.Preferences.appSettings.PaletteBrightnessDark)
}

func TestAppSetPaletteTintDefaultsToZero(t *testing.T) {
	setTestConfigEnv(t)
	app := newSettingsEffectsTestFixture(t)

	settings, err := app.Preferences.GetAppSettings()
	require.NoError(t, err)
	require.Equal(t, 0, settings.PaletteHueLight)
	require.Equal(t, 0, settings.PaletteSaturationLight)
	require.Equal(t, 0, settings.PaletteBrightnessLight)
	require.Equal(t, 0, settings.PaletteHueDark)
	require.Equal(t, 0, settings.PaletteSaturationDark)
	require.Equal(t, 0, settings.PaletteBrightnessDark)
}

func TestAppPaletteTintMigration(t *testing.T) {
	setTestConfigEnv(t)
	app := newSettingsEffectsTestFixture(t)

	// Write an old-format settings file with single-value palette fields.
	configPath, err := app.Preferences.getSettingsFilePath()
	require.NoError(t, err)

	oldSettings := &settingsFile{
		SchemaVersion: settingsSchemaVersion,
		Preferences: settingsPreferences{
			AppearanceMode:           "system",
			GridTablePersistenceMode: "shared",
			PaletteHue:               180,
			PaletteSaturation:        65,
			PaletteBrightness:        -10,
			Refresh:                  &settingsRefresh{Auto: true, Background: true, MetricsIntervalMs: defaultMetricsIntervalMs()},
		},
	}
	bytes, err := json.Marshal(oldSettings)
	require.NoError(t, err)
	writeTestFileWithParents(t, configPath, bytes, 0o644)

	// Load and verify migration copies old values to both mode palettes.
	ensurePreferencesLoaded(t, app.Preferences)
	require.Equal(t, 180, app.Preferences.appSettings.PaletteHueLight)
	require.Equal(t, 65, app.Preferences.appSettings.PaletteSaturationLight)
	require.Equal(t, -10, app.Preferences.appSettings.PaletteBrightnessLight)
	require.Equal(t, 180, app.Preferences.appSettings.PaletteHueDark)
	require.Equal(t, 65, app.Preferences.appSettings.PaletteSaturationDark)
	require.Equal(t, -10, app.Preferences.appSettings.PaletteBrightnessDark)
}

func TestAppSetAccentColorPersists(t *testing.T) {
	setTestConfigEnv(t)
	app := newSettingsEffectsTestFixture(t)

	// Set light accent color.
	require.NoError(t, updatePreference(app.Preferences, appPreferenceAccentColorLight, "#ff5733"))
	require.Equal(t, "#ff5733", app.Preferences.appSettings.AccentColorLight)
	// Dark mode remains untouched.
	require.Equal(t, "", app.Preferences.appSettings.AccentColorDark)

	// Round-trips through save/load.
	app.Preferences.appSettings = nil
	ensurePreferencesLoaded(t, app.Preferences)
	require.Equal(t, "#ff5733", app.Preferences.appSettings.AccentColorLight)
	require.Equal(t, "", app.Preferences.appSettings.AccentColorDark)

	// Logs the change.
	entries := app.AppLogs.logger.GetEntries()
	require.NotEmpty(t, entries)
	last := entries[len(entries)-1]
	require.Equal(t, "INFO", last.Level)
	require.Contains(t, last.Message, "Accent color light changed to: #ff5733")
}

func TestAppSetAccentColorValidation(t *testing.T) {
	setTestConfigEnv(t)
	app := newSettingsEffectsTestFixture(t)

	// Invalid hex format returns error.
	err := updatePreference(app.Preferences, appPreferenceAccentColorLight, "ff5733")
	require.Error(t, err)
	require.Contains(t, err.Error(), "invalid color format")

	// Short hex returns error.
	err = updatePreference(app.Preferences, appPreferenceAccentColorLight, "#fff")
	require.Error(t, err)
	require.Contains(t, err.Error(), "invalid color format")

	// Non-hex characters return error.
	err = updatePreference(app.Preferences, appPreferenceAccentColorDark, "#zzzzzz")
	require.Error(t, err)
	require.Contains(t, err.Error(), "invalid color format")

	// Empty string is accepted (reset).
	require.NoError(t, updatePreference(app.Preferences, appPreferenceAccentColorDark, ""))
	require.Equal(t, "", app.Preferences.appSettings.AccentColorDark)
}

func TestAppSettingsDefaultTablePageSize(t *testing.T) {
	setTestConfigEnv(t)
	app := newSettingsEffectsTestFixture(t)

	// Defaults: a fresh settings file carries the backend-owned default.
	configPath, err := app.Preferences.getSettingsFilePath()
	require.NoError(t, err)
	writeTestFileWithParents(t, configPath, []byte(`{"schemaVersion":0}`), 0o644)
	settings, err := app.Preferences.loadSettingsFile()
	require.NoError(t, err)
	require.Equal(t, defaultTablePageSize, settings.Preferences.DefaultTablePageSize)

	// Schema: integer preference with the default and sanity bounds.
	schema, err := app.Preferences.GetAppSettingsSchema()
	require.NoError(t, err)
	byKey := make(map[string]AppPreferenceSchema, len(schema.Preferences))
	for _, pref := range schema.Preferences {
		byKey[pref.Key] = pref
	}
	require.Equal(t, "integer", byKey[appPreferenceDefaultTablePageSize].Type)
	require.Equal(t, defaultTablePageSize, byKey[appPreferenceDefaultTablePageSize].DefaultValue)
	require.Equal(t, minTablePageSize, *byKey[appPreferenceDefaultTablePageSize].Min)
	require.Equal(t, maxTablePageSize, *byKey[appPreferenceDefaultTablePageSize].Max)

	// Updates persist, clamp to the sanity bounds, and survive a reload.
	response, err := app.Preferences.UpdateAppPreferences(UpdateAppPreferencesRequest{Changes: []AppPreferenceChange{
		{Key: appPreferenceDefaultTablePageSize, Value: 250},
	}})
	require.NoError(t, err)
	require.Equal(t, 250, response.Settings.DefaultTablePageSize)

	response, err = app.Preferences.UpdateAppPreferences(UpdateAppPreferencesRequest{Changes: []AppPreferenceChange{
		{Key: appPreferenceDefaultTablePageSize, Value: 999999},
	}})
	require.NoError(t, err)
	require.Equal(t, maxTablePageSize, response.Settings.DefaultTablePageSize)

	app.Preferences.appSettings = nil
	ensurePreferencesLoaded(t, app.Preferences)
	require.Equal(t, maxTablePageSize, app.Preferences.appSettings.DefaultTablePageSize)
}

// TestGetAppSettingsDoesNotDeadlockWhenSettingsNotLoaded pins the lock-direction
// companion of the limiter fix: Preferences performs disk I/O under settingsMu,
// releases it, and only then dispatches the loaded limit to the limiter leaf lock.
func TestGetAppSettingsDoesNotDeadlockWhenSettingsNotLoaded(t *testing.T) {
	app := newSettingsEffectsTestFixture(t) // settings and limiter are both still lazy

	type result struct {
		settings *AppSettings
		err      error
	}
	done := make(chan result, 1)
	go func() {
		settings, err := app.Preferences.GetAppSettings()
		done <- result{settings: settings, err: err}
	}()

	select {
	case res := <-done:
		require.NoError(t, res.err)
		require.NotNil(t, res.settings)
	case <-time.After(3 * time.Second):
		t.Fatal("GetAppSettings deadlocked: the limiter accessor re-locked settingsMu")
	}
}
