package backend

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/internal/preferenceschema"
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
	require.Equal(t, 600, settings.ObjectPanelDockedRightWidth)
	require.Equal(t, 600, settings.ObjectPanelDockedBottomHeight)
	require.Equal(t, 600, settings.ObjectPanelFloatingWidth)
	require.Equal(t, 800, settings.ObjectPanelFloatingHeight)
}

func TestErrorReportingPreferenceDefaultsEnabled(t *testing.T) {
	setTestConfigEnv(t)
	app := newSettingsEffectsTestFixture(t)

	settings, err := app.Preferences.GetAppSettings()
	require.NoError(t, err)
	require.True(t, settings.ErrorReportingEnabled)
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
		Key:   preferenceschema.KeyErrorReportingEnabled,
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
		AccentColorLight:                         "#326ce5",
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
	require.Equal(t, "#326ce5", app.Preferences.appSettings.AccentColorLight)
	require.Equal(t, "#f59e0b", app.Preferences.appSettings.AccentColorDark)
}

func TestAppSetAppearanceModePersistsAndLogs(t *testing.T) {
	setTestConfigEnv(t)
	app := newSettingsEffectsTestFixture(t)

	require.NoError(t, updatePreference(app.Preferences, preferenceschema.KeyAppearanceMode, "dark"))
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

	err := updatePreference(app.Preferences, preferenceschema.KeyAppearanceMode, "blue")
	require.Error(t, err)
	require.Contains(t, err.Error(), "invalid appearance mode")
}

func TestAppSetUseShortResourceNamesPersists(t *testing.T) {
	setTestConfigEnv(t)
	app := newSettingsEffectsTestFixture(t)

	require.NoError(t, updatePreference(app.Preferences, preferenceschema.KeyUseShortResourceNames, true))
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

	require.NoError(t, updatePreference(app.Preferences, preferenceschema.KeyDimInactiveNamespaces, false))
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

func TestSidebarGroupExpansionPersistsIndependentlyWithoutLogging(t *testing.T) {
	setTestConfigEnv(t)
	logger := NewLogger(20)
	preferences := NewPreferencesService(nil, nil, logger)
	keys := []string{"sidebarClusterResourcesExpanded", "sidebarClusterExtensionsExpanded", "sidebarNamespaceResourcesExpanded", "sidebarNamespaceExtensionsExpanded"}
	defaults := readPreferenceValues(t, preferences)
	require.Equal(t, true, defaults[keys[0]], "Resources holds the default namespace view, so it starts open")
	require.Equal(t, false, defaults[keys[1]])
	require.Equal(t, true, defaults[keys[2]], "Resources holds the default namespace view, so it starts open")
	require.Equal(t, false, defaults[keys[3]])
	for _, key := range keys {
		require.NoError(t, updatePreference(preferences, key, true))
	}
	require.NoError(t, updatePreference(preferences, keys[0], false))
	require.NoError(t, updatePreference(preferences, keys[3], false))
	values := readPreferenceValues(t, NewPreferencesService(nil, nil, nil))
	require.Equal(t, false, values[keys[0]])
	require.Equal(t, true, values[keys[1]])
	require.Equal(t, true, values[keys[2]])
	require.Equal(t, false, values[keys[3]])
	require.Empty(t, logger.GetEntries(), "sidebar disclosure must persist without creating application logs")
}

// Installations that already saved a Resources state keep it; only a missing
// value takes the open default.
func TestSidebarResourcesSavedStateSurvivesTheOpenDefault(t *testing.T) {
	setTestConfigEnv(t)
	preferences := NewPreferencesService(nil, nil, nil)
	configPath, err := preferences.getSettingsFilePath()
	require.NoError(t, err)
	writeTestFileWithParents(t, configPath, []byte(`{
		"schemaVersion": 1,
		"preferences": {
			"sidebarClusterResourcesExpanded": false,
			"appearanceMode": "dark"
		}
	}`), 0o644)

	values := readPreferenceValues(t, preferences)
	require.Equal(t, false, values[preferenceschema.KeySidebarClusterResourcesExpanded])
	require.Equal(t, true, values[preferenceschema.KeySidebarNamespaceResourcesExpanded])

	require.NoError(t, updatePreference(preferences, preferenceschema.KeySidebarNamespaceExtensionsExpanded, true))
	values = readPreferenceValues(t, NewPreferencesService(nil, nil, nil))
	require.Equal(t, false, values[preferenceschema.KeySidebarClusterResourcesExpanded])
	require.Equal(t, true, values[preferenceschema.KeySidebarNamespaceResourcesExpanded])
	require.Equal(t, true, values[preferenceschema.KeySidebarNamespaceExtensionsExpanded])
	require.Equal(t, "dark", values[preferenceschema.KeyAppearanceMode])
}

func readPreferenceValues(t *testing.T, owner *PreferencesService) map[string]any {
	t.Helper()
	settings, err := owner.GetAppSettings()
	require.NoError(t, err)
	return appSettingsJSON(t, settings)
}

func TestAppPreferenceBatchKeepsOtherLogsWithSidebarChanges(t *testing.T) {
	setTestConfigEnv(t)
	logger := NewLogger(20)
	preferences := NewPreferencesService(nil, nil, logger)
	require.NoError(t, updatePreferences(preferences,
		AppPreferenceChange{Key: preferenceschema.KeySidebarClusterResourcesExpanded, Value: true},
		AppPreferenceChange{Key: preferenceschema.KeyUseShortResourceNames, Value: true},
		AppPreferenceChange{Key: preferenceschema.KeySidebarNamespaceExtensionsExpanded, Value: true},
		AppPreferenceChange{Key: preferenceschema.KeyObjectPanelFloatingWidth, Value: 800},
	))
	require.Len(t, logger.GetEntries(), 2, "both named and generic logs must survive a batch containing sidebar changes")
}

func TestAppSetExclusiveNamespacesPersists(t *testing.T) {
	setTestConfigEnv(t)
	app := newSettingsEffectsTestFixture(t)

	settings, err := app.Preferences.GetAppSettings()
	require.NoError(t, err)
	require.True(t, settings.ExclusiveNamespaces)

	require.NoError(t, updatePreference(app.Preferences, preferenceschema.KeyExclusiveNamespaces, false))
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

	require.NoError(t, updatePreference(app.Preferences, preferenceschema.KeyAutoRefreshEnabled, false))
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

func TestAppSetObjPanelLogsBufferMaxSizePersistsAndClamps(t *testing.T) {
	setTestConfigEnv(t)

	// In-range value round-trips unchanged.
	app := newSettingsEffectsTestFixture(t)
	require.NoError(t, updatePreference(app.Preferences, preferenceschema.KeyObjPanelLogsBufferMaxSize, 2500))
	require.Equal(t, 2500, app.Preferences.appSettings.ObjPanelLogsBufferMaxSize)

	app.Preferences.appSettings = nil
	ensurePreferencesLoaded(t, app.Preferences)
	require.Equal(t, 2500, app.Preferences.appSettings.ObjPanelLogsBufferMaxSize)

	entries := app.AppLogs.logger.GetEntries()
	require.NotEmpty(t, entries)
	require.Contains(t, entries[len(entries)-1].Message, "ObjPanelLogs buffer max size changed to: 2500")

	// Out-of-range values clamp to the allowed range.
	require.NoError(t, updatePreference(app.Preferences, preferenceschema.KeyObjPanelLogsBufferMaxSize, 50))
	require.Equal(t, preferenceschema.MinObjPanelLogsBufferMaxSize, app.Preferences.appSettings.ObjPanelLogsBufferMaxSize)

	require.NoError(t, updatePreference(app.Preferences, preferenceschema.KeyObjPanelLogsBufferMaxSize, 50000))
	require.Equal(t, preferenceschema.MaxObjPanelLogsBufferMaxSize, app.Preferences.appSettings.ObjPanelLogsBufferMaxSize)

	// Default is returned when the settings file has no entry yet.
	setTestConfigEnv(t)
	freshApp := newSettingsEffectsTestFixture(t)
	settings, err := freshApp.Preferences.GetAppSettings()
	require.NoError(t, err)
	require.Equal(t, 5000, settings.ObjPanelLogsBufferMaxSize, "a new install keeps 5,000 lines per Logs tab")
	require.Equal(t, preferenceschema.DefaultObjPanelLogsTargetPerScopeLimit, settings.ObjPanelLogsTargetPerScopeLimit)
	require.Equal(t, preferenceschema.DefaultObjPanelLogsTargetGlobalLimit, settings.ObjPanelLogsTargetGlobalLimit)
	require.Equal(t, preferenceschema.DefaultObjPanelLogsAPITimestampFormat, settings.ObjPanelLogsAPITimestampFormat)
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
		AppPreferenceChange{Key: preferenceschema.KeyKubernetesClientQPS, Value: 250},
		AppPreferenceChange{Key: preferenceschema.KeyKubernetesClientBurst, Value: 500},
		AppPreferenceChange{Key: preferenceschema.KeyPermissionSSRRFetchConcurrency, Value: 16},
	))
	require.Equal(t, 250, app.Preferences.appSettings.KubernetesClientQPS)
	require.Equal(t, 500, app.Preferences.appSettings.KubernetesClientBurst)
	require.Equal(t, 16, app.Preferences.appSettings.PermissionSSRRFetchConcurrency)

	app.Preferences.appSettings = nil
	ensurePreferencesLoaded(t, app.Preferences)
	require.Equal(t, 250, app.Preferences.appSettings.KubernetesClientQPS)
	require.Equal(t, 500, app.Preferences.appSettings.KubernetesClientBurst)
	require.Equal(t, 16, app.Preferences.appSettings.PermissionSSRRFetchConcurrency)

	require.NoError(t, updatePreference(app.Preferences, preferenceschema.KeyKubernetesClientQPS, 999_999))
	require.Equal(t, preferenceschema.MaxKubernetesClientQPS, app.Preferences.appSettings.KubernetesClientQPS)

	require.NoError(t, updatePreference(app.Preferences, preferenceschema.KeyKubernetesClientBurst, 999_999))
	require.Equal(t, preferenceschema.MaxKubernetesClientBurst, app.Preferences.appSettings.KubernetesClientBurst)

	require.NoError(t, updatePreference(app.Preferences, preferenceschema.KeyPermissionSSRRFetchConcurrency, 999_999))
	require.Equal(t, preferenceschema.MaxPermissionSSRRFetchConcurrency, app.Preferences.appSettings.PermissionSSRRFetchConcurrency)

	setTestConfigEnv(t)
	freshApp := newSettingsEffectsTestFixture(t)
	settings, err := freshApp.Preferences.GetAppSettings()
	require.NoError(t, err)
	require.Equal(t, preferenceschema.DefaultKubernetesClientQPS, settings.KubernetesClientQPS)
	require.Equal(t, preferenceschema.DefaultKubernetesClientBurst, settings.KubernetesClientBurst)
	require.Equal(t, preferenceschema.DefaultPermissionSSRRFetchConcurrency, settings.PermissionSSRRFetchConcurrency)
}

// Zero or a negative value means "use the default" for every integer setting
// whose minimum is at least 1: the same rule settings.json loads with and the
// Settings UI applies before saving.
func TestAppPreferenceNonPositiveIntegersUseDefaults(t *testing.T) {
	cases := []struct {
		key   string
		want  int
		field func(*AppSettings) int
	}{
		{preferenceschema.KeyKubernetesClientQPS, preferenceschema.DefaultKubernetesClientQPS, func(s *AppSettings) int { return s.KubernetesClientQPS }},
		{preferenceschema.KeyKubernetesClientBurst, preferenceschema.DefaultKubernetesClientBurst, func(s *AppSettings) int { return s.KubernetesClientBurst }},
		{preferenceschema.KeyPermissionSSRRFetchConcurrency, preferenceschema.DefaultPermissionSSRRFetchConcurrency, func(s *AppSettings) int { return s.PermissionSSRRFetchConcurrency }},
		{preferenceschema.KeyObjPanelLogsBufferMaxSize, preferenceschema.DefaultObjPanelLogsBufferMaxSize, func(s *AppSettings) int { return s.ObjPanelLogsBufferMaxSize }},
		{preferenceschema.KeyObjPanelLogsTargetPerScopeLimit, preferenceschema.DefaultObjPanelLogsTargetPerScopeLimit, func(s *AppSettings) int { return s.ObjPanelLogsTargetPerScopeLimit }},
		{preferenceschema.KeyObjPanelLogsTargetGlobalLimit, preferenceschema.DefaultObjPanelLogsTargetGlobalLimit, func(s *AppSettings) int { return s.ObjPanelLogsTargetGlobalLimit }},
		{preferenceschema.KeyObjectPanelDockedRightWidth, preferenceschema.DefaultObjectPanelDockedRightWidth, func(s *AppSettings) int { return s.ObjectPanelDockedRightWidth }},
		{preferenceschema.KeyObjectPanelDockedBottomHeight, preferenceschema.DefaultObjectPanelDockedBottomHeight, func(s *AppSettings) int { return s.ObjectPanelDockedBottomHeight }},
		{preferenceschema.KeyObjectPanelFloatingWidth, preferenceschema.DefaultObjectPanelFloatingWidth, func(s *AppSettings) int { return s.ObjectPanelFloatingWidth }},
		{preferenceschema.KeyObjectPanelFloatingHeight, preferenceschema.DefaultObjectPanelFloatingHeight, func(s *AppSettings) int { return s.ObjectPanelFloatingHeight }},
		{preferenceschema.KeyMetricsRefreshIntervalMs, preferenceschema.DefaultMetricsRefreshIntervalMs, func(s *AppSettings) int { return s.MetricsRefreshIntervalMs }},
	}
	setTestConfigEnv(t)
	app := newSettingsEffectsTestFixture(t)
	for _, tc := range cases {
		for _, value := range []any{0, -0.1} {
			t.Run(fmt.Sprintf("%s=%v", tc.key, value), func(t *testing.T) {
				// Move off the default first so the assertion sees the rule apply.
				require.NoError(t, updatePreference(app.Preferences, tc.key, tc.want+1))
				response, err := app.Preferences.UpdateAppPreferences(UpdateAppPreferencesRequest{
					Changes: []AppPreferenceChange{{Key: tc.key, Value: value}},
				})
				require.NoError(t, err)
				require.Equal(t, tc.want, tc.field(response.Settings))
			})
		}
	}
}

// A positive fraction is an ordinary value: it truncates toward zero and then
// clamps, so it never becomes the default.
func TestAppPreferenceFractionalIntegersTruncateTowardZero(t *testing.T) {
	setTestConfigEnv(t)
	app := newSettingsEffectsTestFixture(t)

	require.NoError(t, updatePreferences(app.Preferences,
		AppPreferenceChange{Key: preferenceschema.KeyKubernetesClientQPS, Value: 0.9},
		AppPreferenceChange{Key: preferenceschema.KeyObjectPanelDockedRightWidth, Value: 0.5},
		AppPreferenceChange{Key: preferenceschema.KeyPaletteBrightnessLight, Value: -0.5},
		AppPreferenceChange{Key: preferenceschema.KeyPaletteBrightnessDark, Value: -10.7},
	))

	settings := app.Preferences.appSettings
	require.Equal(t, 1, settings.KubernetesClientQPS)
	require.Equal(t, 500, settings.ObjectPanelDockedRightWidth)
	require.Equal(t, 0, settings.PaletteBrightnessLight)
	require.Equal(t, -10, settings.PaletteBrightnessDark)
}

func TestAppSetKubernetesClientRateLimitsUpdatesExistingClients(t *testing.T) {
	setTestConfigEnv(t)

	app := newSettingsEffectsTestFixture(t)
	app.ClusterRuntime.kubeAPIMetrics = newKubernetesAPIMetricsRegistry()
	limiter := newMutableKubernetesRateLimiter(preferenceschema.DefaultKubernetesClientQPS, preferenceschema.DefaultKubernetesClientBurst)
	app.ClusterRuntime.clusterClients = map[string]*clusterClients{
		"cluster-a": {
			meta:        ClusterMeta{ID: "cluster-a", Name: "Cluster A"},
			rateLimiter: limiter,
			restConfig:  &rest.Config{QPS: float32(preferenceschema.DefaultKubernetesClientQPS), Burst: preferenceschema.DefaultKubernetesClientBurst},
		},
	}
	app.ClusterRuntime.kubeAPIMetrics.getOrCreate(ClusterMeta{ID: "cluster-a", Name: "Cluster A"}, preferenceschema.DefaultKubernetesClientQPS, preferenceschema.DefaultKubernetesClientBurst)

	require.NoError(t, updatePreference(app.Preferences, preferenceschema.KeyKubernetesClientQPS, 150))
	qps, burst := limiter.Limits()
	require.Equal(t, 150, qps)
	require.Equal(t, preferenceschema.DefaultKubernetesClientBurst, burst)
	require.Equal(t, float32(150), app.ClusterRuntime.clusterClients["cluster-a"].restConfig.QPS)
	require.Equal(t, preferenceschema.DefaultKubernetesClientBurst, app.ClusterRuntime.clusterClients["cluster-a"].restConfig.Burst)

	require.NoError(t, updatePreference(app.Preferences, preferenceschema.KeyKubernetesClientBurst, 450))
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
	require.NoError(t, updatePreference(app.Preferences, preferenceschema.KeyObjPanelLogsTargetPerScopeLimit, 144))
	require.Equal(t, 144, app.Preferences.appSettings.ObjPanelLogsTargetPerScopeLimit)

	app.Preferences.appSettings = nil
	ensurePreferencesLoaded(t, app.Preferences)
	require.Equal(t, 144, app.Preferences.appSettings.ObjPanelLogsTargetPerScopeLimit)

	entries := app.AppLogs.logger.GetEntries()
	require.NotEmpty(t, entries)
	require.Contains(t, entries[len(entries)-1].Message, "Object Panel Logs Tab target per-scope limit changed to: 144")

	require.NoError(t, updatePreference(app.Preferences, preferenceschema.KeyObjPanelLogsTargetPerScopeLimit, 999_999))
	require.Equal(t, preferenceschema.MaxObjPanelLogsTargetPerScopeLimit, app.Preferences.appSettings.ObjPanelLogsTargetPerScopeLimit)
}

// Troubleshooting the app can need more history than a Logs tab keeps, so the
// Logs tabs' Buffer size never shrinks Application Logs.
func TestAppSetObjPanelLogsBufferMaxSizeLeavesApplicationLogsAlone(t *testing.T) {
	setTestConfigEnv(t)

	app := newSettingsEffectsTestFixture(t)
	require.NoError(t, updatePreference(app.Preferences, preferenceschema.KeyObjPanelLogsBufferMaxSize, 150))
	for i := range 200 {
		app.AppLogs.logger.Info(fmt.Sprintf("line %d", i))
	}

	entries := app.AppLogs.logger.GetEntries()
	require.Len(t, entries, 201)
	require.Equal(t, "line 199", entries[len(entries)-1].Message)
}

func TestAppSetObjPanelLogsTargetGlobalLimitPersistsAndClamps(t *testing.T) {
	setTestConfigEnv(t)

	app := newSettingsEffectsTestFixture(t)
	require.NoError(t, updatePreference(app.Preferences, preferenceschema.KeyObjPanelLogsTargetGlobalLimit, 180))
	require.Equal(t, 180, app.Preferences.appSettings.ObjPanelLogsTargetGlobalLimit)

	app.Preferences.appSettings = nil
	ensurePreferencesLoaded(t, app.Preferences)
	require.Equal(t, 180, app.Preferences.appSettings.ObjPanelLogsTargetGlobalLimit)

	entries := app.AppLogs.logger.GetEntries()
	require.NotEmpty(t, entries)
	require.Contains(t, entries[len(entries)-1].Message, "Object Panel Logs Tab target global limit changed to: 180")

	require.NoError(t, updatePreference(app.Preferences, preferenceschema.KeyObjPanelLogsTargetGlobalLimit, 999_999))
	require.Equal(t, preferenceschema.MaxObjPanelLogsTargetGlobalLimit, app.Preferences.appSettings.ObjPanelLogsTargetGlobalLimit)
}

func TestAppSetObjPanelLogsAPITimestampFormatPersists(t *testing.T) {
	setTestConfigEnv(t)

	app := newSettingsEffectsTestFixture(t)
	require.NoError(t, updatePreference(app.Preferences, preferenceschema.KeyObjPanelLogsAPITimestampFormat, "HH:mm:ss.SSS"))
	require.Equal(t, "HH:mm:ss.SSS", app.Preferences.appSettings.ObjPanelLogsAPITimestampFormat)

	app.Preferences.appSettings = nil
	ensurePreferencesLoaded(t, app.Preferences)
	require.Equal(t, "HH:mm:ss.SSS", app.Preferences.appSettings.ObjPanelLogsAPITimestampFormat)

	entries := app.AppLogs.logger.GetEntries()
	require.NotEmpty(t, entries)
	require.Contains(t, entries[len(entries)-1].Message, "Object Panel Logs Tab API timestamp format changed to: HH:mm:ss.SSS")

	require.NoError(t, updatePreference(app.Preferences, preferenceschema.KeyObjPanelLogsAPITimestampFormat, ""))
	require.Equal(t, preferenceschema.DefaultObjPanelLogsAPITimestampFormat, app.Preferences.appSettings.ObjPanelLogsAPITimestampFormat)
}

func TestAppSetObjPanelLogsAPITimestampUseLocalTimeZonePersists(t *testing.T) {
	setTestConfigEnv(t)

	app := newSettingsEffectsTestFixture(t)
	require.NoError(t, updatePreference(app.Preferences, preferenceschema.KeyObjPanelLogsAPITimestampUseLocalTimeZone, true))
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

	require.NoError(t, updatePreference(app.Preferences, preferenceschema.KeyGridTablePersistenceMode, "namespaced"))
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

	err := updatePreference(app.Preferences, preferenceschema.KeyGridTablePersistenceMode, "invalid")
	require.Error(t, err)
	require.Contains(t, err.Error(), "invalid grid table persistence mode")
}

func TestAppSetDefaultObjectPanelPositionPersists(t *testing.T) {
	setTestConfigEnv(t)
	app := newSettingsEffectsTestFixture(t)

	require.NoError(t, updatePreference(app.Preferences, preferenceschema.KeyDefaultObjectPanelPosition, "bottom"))
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

	err := updatePreference(app.Preferences, preferenceschema.KeyDefaultObjectPanelPosition, "invalid")
	require.Error(t, err)
	require.Contains(t, err.Error(), "invalid default object panel position")
}

func TestAppGetAppearanceModeInfoReflectsCurrentSettings(t *testing.T) {
	setTestConfigEnv(t)
	app := newSettingsEffectsTestFixture(t)

	require.NoError(t, updatePreference(app.Preferences, preferenceschema.KeyAppearanceMode, "light"))
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
	require.Equal(t, "shared", settings.Preferences.GridTablePersistenceMode)
	require.Equal(t, preferenceschema.DefaultObjectPanelPosition, settings.Preferences.DefaultObjectPanelPosition)
	require.Equal(t, preferenceschema.DefaultObjectPanelDockedRightWidth, settings.Preferences.ObjectPanelDockedRightWidth)
	require.Equal(t, preferenceschema.DefaultObjectPanelDockedBottomHeight, settings.Preferences.ObjectPanelDockedBottomHeight)
	require.Equal(t, preferenceschema.DefaultObjectPanelFloatingWidth, settings.Preferences.ObjectPanelFloatingWidth)
	require.Equal(t, preferenceschema.DefaultObjectPanelFloatingHeight, settings.Preferences.ObjectPanelFloatingHeight)
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
				ClientQPS:                      preferenceschema.MaxKubernetesClientQPS + 1,
				ClientBurst:                    preferenceschema.MaxKubernetesClientBurst + 1,
				PermissionSSRRFetchConcurrency: preferenceschema.MaxPermissionSSRRFetchConcurrency + 1,
			},
			ObjPanelLogs: &settingsObjPanelLogs{
				BufferMaxSize:       preferenceschema.MaxObjPanelLogsBufferMaxSize + 1,
				TargetPerScopeLimit: preferenceschema.MaxObjPanelLogsTargetPerScopeLimit + 1,
				TargetGlobalLimit:   preferenceschema.MaxObjPanelLogsTargetGlobalLimit + 1,
				APITimestampFormat:  "HH:mm:ss",
			},
			GridTablePersistenceMode:      "per-cluster",
			DefaultTablePageSize:          37,
			DefaultObjectPanelPosition:    "bottom",
			ObjectPanelDockedRightWidth:   preferenceschema.MaxObjectPanelLayoutValue + 1,
			ObjectPanelDockedBottomHeight: preferenceschema.MaxObjectPanelLayoutValue + 1,
			ObjectPanelFloatingWidth:      preferenceschema.MaxObjectPanelLayoutValue + 1,
			ObjectPanelFloatingHeight:     preferenceschema.MaxObjectPanelLayoutValue + 1,
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
	require.Equal(t, preferenceschema.MaxKubernetesClientQPS, got.Preferences.KubernetesAPI.ClientQPS)
	require.Equal(t, preferenceschema.MaxKubernetesClientBurst, got.Preferences.KubernetesAPI.ClientBurst)
	require.Equal(t, preferenceschema.MaxPermissionSSRRFetchConcurrency, got.Preferences.KubernetesAPI.PermissionSSRRFetchConcurrency)
	require.Equal(t, preferenceschema.MaxObjPanelLogsBufferMaxSize, got.Preferences.ObjPanelLogs.BufferMaxSize)
	require.Equal(t, preferenceschema.MaxObjPanelLogsTargetPerScopeLimit, got.Preferences.ObjPanelLogs.TargetPerScopeLimit)
	require.Equal(t, preferenceschema.MaxObjPanelLogsTargetGlobalLimit, got.Preferences.ObjPanelLogs.TargetGlobalLimit)
	require.Equal(t, preferenceschema.DefaultTablePageSize, got.Preferences.DefaultTablePageSize, "an off-list page size repairs to the default")
	require.Equal(t, preferenceschema.MaxObjectPanelLayoutValue, got.Preferences.ObjectPanelDockedRightWidth)
	require.Equal(t, preferenceschema.MaxObjectPanelLayoutValue, got.Preferences.ObjectPanelFloatingHeight)
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

// repairableValues are the stored values a read repairs.
type repairableValues struct {
	AppearanceMode, GridTablePersistenceMode, DefaultObjectPanelPosition string
	AccentColorLight, LinkColorDark                                      string
	PaletteHueLight, PaletteSaturationDark, PaletteBrightnessLight       int
	DefaultTablePageSize                                                 int
}

func repairableFromFile(p settingsPreferences) repairableValues {
	return repairableValues{
		p.AppearanceMode, p.GridTablePersistenceMode, p.DefaultObjectPanelPosition,
		p.AccentColorLight, p.LinkColorDark,
		p.PaletteHueLight, p.PaletteSaturationDark, p.PaletteBrightnessLight,
		p.DefaultTablePageSize,
	}
}

// A hand-edited or older settings.json can hold values the frontend has always
// repaired on display. The backend repairs them the same way when it reads the
// file, so the values it serves, exports, and saves back match what the UI shows.
func TestSettingsReadsRepairStoredValues(t *testing.T) {
	setTestConfigEnv(t)
	app := newSettingsEffectsTestFixture(t)
	configPath, err := app.Preferences.getSettingsFilePath()
	require.NoError(t, err)
	writeTestFileWithParents(t, configPath, []byte(`{"schemaVersion":1,"preferences":{
		"appearanceMode":"sepia","gridTablePersistenceMode":"per-cluster","defaultObjectPanelPosition":"left",
		"accentColorLight":"#zzz","linkColorDark":"blue",
		"paletteHueLight":999,"paletteSaturationDark":-5,"paletteBrightnessLight":80,
		"defaultTablePageSize":37}}`), 0o644)
	want := repairableValues{
		AppearanceMode: "system", GridTablePersistenceMode: "shared", DefaultObjectPanelPosition: "right",
		PaletteHueLight: 360, PaletteSaturationDark: 0, PaletteBrightnessLight: 50,
		DefaultTablePageSize: 50,
	}

	settings, err := app.Preferences.GetAppSettings()
	require.NoError(t, err)
	require.Equal(t, want, repairableValues{
		settings.AppearanceMode, settings.GridTablePersistenceMode, settings.DefaultObjectPanelPosition,
		settings.AccentColorLight, settings.LinkColorDark,
		settings.PaletteHueLight, settings.PaletteSaturationDark, settings.PaletteBrightnessLight,
		settings.DefaultTablePageSize,
	})

	exported, err := app.Preferences.exportSettingsDocument()
	require.NoError(t, err)
	require.Equal(t, want, repairableFromFile(exported.Preferences))

	require.NoError(t, updatePreference(app.Preferences, preferenceschema.KeyUseShortResourceNames, true))
	data, err := os.ReadFile(configPath)
	require.NoError(t, err)
	var saved settingsFile
	require.NoError(t, json.Unmarshal(data, &saved))
	require.Equal(t, want, repairableFromFile(saved.Preferences))
}

func TestNormalizeSettingsFileCompletesZeroValueDefaults(t *testing.T) {
	settings := normalizeSettingsFile(&settingsFile{})

	require.Equal(t, settingsSchemaVersion, settings.SchemaVersion)
	require.Equal(t, "system", settings.Preferences.AppearanceMode)
	require.True(t, *settings.Preferences.DimInactiveNamespaces)
	require.True(t, *settings.Preferences.ExclusiveNamespaces)
	require.True(t, *settings.Preferences.ErrorReportingEnabled)
	require.Equal(t, &settingsRefresh{Auto: true, MetricsIntervalMs: preferenceschema.DefaultMetricsRefreshIntervalMs}, settings.Preferences.Refresh)
	require.Equal(t, &settingsKubernetesAPI{
		ClientQPS:                      preferenceschema.DefaultKubernetesClientQPS,
		ClientBurst:                    preferenceschema.DefaultKubernetesClientBurst,
		PermissionSSRRFetchConcurrency: preferenceschema.DefaultPermissionSSRRFetchConcurrency,
	}, settings.Preferences.KubernetesAPI)
	require.Equal(t, &settingsObjPanelLogs{
		BufferMaxSize:       preferenceschema.DefaultObjPanelLogsBufferMaxSize,
		TargetPerScopeLimit: preferenceschema.DefaultObjPanelLogsTargetPerScopeLimit,
		TargetGlobalLimit:   preferenceschema.DefaultObjPanelLogsTargetGlobalLimit,
		APITimestampFormat:  preferenceschema.DefaultObjPanelLogsAPITimestampFormat,
	}, settings.Preferences.ObjPanelLogs)
	require.Equal(t, preferenceschema.DefaultTablePageSize, settings.Preferences.DefaultTablePageSize)
	require.Equal(t, []Theme{defaultTheme()}, settings.Preferences.Themes)
	require.Equal(t, defaultKubeconfigSearchPaths(), settings.Kubeconfig.SearchPaths)
}

func TestNormalizeSettingsFileCompletesPartiallyPresentNestedDefaults(t *testing.T) {
	settings := normalizeSettingsFile(&settingsFile{Preferences: settingsPreferences{
		Refresh:      &settingsRefresh{},
		ObjPanelLogs: &settingsObjPanelLogs{},
	}})

	require.Equal(t, preferenceschema.DefaultMetricsRefreshIntervalMs, settings.Preferences.Refresh.MetricsIntervalMs)
	require.Equal(t, preferenceschema.DefaultObjPanelLogsAPITimestampFormat, settings.Preferences.ObjPanelLogs.APITimestampFormat)
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

// nonDefaultValue picks a valid value other than the preference's default.
func nonDefaultValue(p preferenceschema.Preference) any {
	switch p.Type {
	case preferenceschema.Boolean:
		return !p.Default.(bool)
	case preferenceschema.Enum:
		for _, option := range p.Options {
			if option != p.Default {
				return option
			}
		}
	case preferenceschema.Color:
		return "#123456"
	case preferenceschema.String:
		return "HH:mm"
	case preferenceschema.Integer:
		for _, option := range p.IntOptions {
			if option != p.Default {
				return option
			}
		}
		if p.Max != nil {
			return *p.Max
		}
		return p.Default.(int) + 1
	}
	panic("no non-default value for " + p.Key)
}

// appSettingsJSON reads AppSettings by the JSON names the frontend uses.
func appSettingsJSON(t *testing.T, settings *AppSettings) map[string]any {
	t.Helper()
	data, err := json.Marshal(settings)
	require.NoError(t, err)
	var values map[string]any
	require.NoError(t, json.Unmarshal(data, &values))
	return values
}

// Every schema key is bound, in schema order, to the AppSettings field the
// frontend reads under the same JSON name, and AppSettings has no preference
// field the schema leaves out.
func TestEveryPreferenceIsBoundToItsAppSettingsField(t *testing.T) {
	specs := preferenceschema.All()
	specKeys := make([]string, 0, len(specs))
	for _, spec := range specs {
		specKeys = append(specKeys, spec.Key)
	}
	boundKeys := make([]string, 0, len(appPreferenceDescriptors()))
	for _, descriptor := range appPreferenceDescriptors() {
		boundKeys = append(boundKeys, descriptor.spec.Key)
	}
	require.Equal(t, specKeys, boundKeys)

	notPreferences := map[string]bool{"anonymizedId": true, "selectedKubeconfigs": true, "themes": true}
	fields := reflect.TypeFor[AppSettings]()
	var tagged []string
	for index := range fields.NumField() {
		name := strings.Split(fields.Field(index).Tag.Get("json"), ",")[0]
		if !notPreferences[name] {
			tagged = append(tagged, name)
		}
	}
	require.ElementsMatch(t, specKeys, tagged)

	for _, descriptor := range appPreferenceDescriptors() {
		settings := defaultAppPreferences()
		value := nonDefaultValue(descriptor.spec)
		require.NoError(t, descriptor.apply(settings, value, &settingsSideEffects{}))
		require.EqualValues(t, value, appSettingsJSON(t, settings)[descriptor.spec.Key], descriptor.spec.Key)
	}
}

// Every preference survives a save and reload, which catches a key missing
// from the settings.json mappings.
func TestEveryPreferenceSurvivesSaveAndReload(t *testing.T) {
	setTestConfigEnv(t)
	app := newSettingsEffectsTestFixture(t)
	want := map[string]any{}
	changes := []AppPreferenceChange{}
	for _, spec := range preferenceschema.All() {
		value := nonDefaultValue(spec)
		want[spec.Key] = value
		changes = append(changes, AppPreferenceChange{Key: spec.Key, Value: value})
	}
	require.NoError(t, updatePreferences(app.Preferences, changes...))

	app.Preferences.appSettings = nil
	reloaded := ensurePreferencesLoaded(t, app.Preferences).Settings
	got := appSettingsJSON(t, reloaded)
	for key, value := range want {
		require.EqualValues(t, value, got[key], key)
	}
}

func TestAppUpdateAppPreferencesAppliesAtomicBatch(t *testing.T) {
	setTestConfigEnv(t)
	app := newSettingsEffectsTestFixture(t)
	app.ClusterRuntime.kubeAPIMetrics = newKubernetesAPIMetricsRegistry()
	limiter := newMutableKubernetesRateLimiter(preferenceschema.DefaultKubernetesClientQPS, preferenceschema.DefaultKubernetesClientBurst)
	app.ClusterRuntime.clusterClients = map[string]*clusterClients{
		"cluster-a": {
			meta:        ClusterMeta{ID: "cluster-a", Name: "Cluster A"},
			rateLimiter: limiter,
			restConfig:  &rest.Config{QPS: float32(preferenceschema.DefaultKubernetesClientQPS), Burst: preferenceschema.DefaultKubernetesClientBurst},
		},
	}

	response, err := app.Preferences.UpdateAppPreferences(UpdateAppPreferencesRequest{Changes: []AppPreferenceChange{
		{Key: preferenceschema.KeyAppearanceMode, Value: "dark"},
		{Key: preferenceschema.KeyKubernetesClientQPS, Value: 150},
		{Key: preferenceschema.KeyKubernetesClientBurst, Value: 450},
		{Key: preferenceschema.KeyObjPanelLogsTargetPerScopeLimit, Value: 144},
		{Key: preferenceschema.KeyDefaultObjectPanelPosition, Value: "bottom"},
	}})
	require.NoError(t, err)
	require.Equal(t, []string{
		preferenceschema.KeyAppearanceMode,
		preferenceschema.KeyKubernetesClientQPS,
		preferenceschema.KeyKubernetesClientBurst,
		preferenceschema.KeyObjPanelLogsTargetPerScopeLimit,
		preferenceschema.KeyDefaultObjectPanelPosition,
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
	require.NoError(t, updatePreference(app.Preferences, preferenceschema.KeyAppearanceMode, "light"))

	_, err := app.Preferences.UpdateAppPreferences(UpdateAppPreferencesRequest{Changes: []AppPreferenceChange{
		{Key: preferenceschema.KeyAppearanceMode, Value: "dark"},
		{Key: preferenceschema.KeyGridTablePersistenceMode, Value: "invalid"},
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
	app.ContainerLogsPolicy.SetContainerLogsPerScopeLimit(preferenceschema.DefaultObjPanelLogsTargetPerScopeLimit)
	require.NoError(t, updatePreference(app.Preferences, preferenceschema.KeyObjPanelLogsTargetPerScopeLimit, 144))
	require.Equal(t, 144, app.ContainerLogsPolicy.Limit())

	originalWrite := writeSettingsFileAtomic
	t.Cleanup(func() {
		writeSettingsFileAtomic = originalWrite
		app.ContainerLogsPolicy.SetContainerLogsPerScopeLimit(preferenceschema.DefaultObjPanelLogsTargetPerScopeLimit)
	})
	writeSettingsFileAtomic = func(string, []byte, os.FileMode) error {
		return errors.New("forced write failure")
	}

	_, err := app.Preferences.UpdateAppPreferences(UpdateAppPreferencesRequest{Changes: []AppPreferenceChange{
		{Key: preferenceschema.KeyObjPanelLogsTargetPerScopeLimit, Value: 222},
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
	rateLimiter := newMutableKubernetesRateLimiter(preferenceschema.DefaultKubernetesClientQPS, preferenceschema.DefaultKubernetesClientBurst)
	app.ClusterRuntime.clusterClients = map[string]*clusterClients{
		"cluster-a": {
			meta:        ClusterMeta{ID: "cluster-a", Name: "Cluster A"},
			rateLimiter: rateLimiter,
			restConfig:  &rest.Config{QPS: float32(preferenceschema.DefaultKubernetesClientQPS), Burst: preferenceschema.DefaultKubernetesClientBurst},
		},
	}
	metricsPoller := &settingsMetricsPoller{}
	app.Refresh.refreshSubsystems = map[string]*system.Subsystem{
		"cluster-a": {Manager: refresh.NewManager(nil, nil, nil, metricsPoller, nil)},
	}
	require.NotNil(t, app.Refresh.containerLogsTargetLimiter)
	initialSession := app.Refresh.containerLogsTargetLimiter.StartSession("cluster-a", "initial-default")
	initialTargets := make([]string, preferenceschema.DefaultObjPanelLogsTargetGlobalLimit+1)
	for index := range initialTargets {
		initialTargets[index] = fmt.Sprintf("target-%d", index)
	}
	allowed, skipped := initialSession.UpdateDesired(initialTargets)
	require.Len(t, allowed, preferenceschema.DefaultObjPanelLogsTargetGlobalLimit)
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
		AppPreferenceChange{Key: preferenceschema.KeyPaletteHueLight, Value: 220},
		AppPreferenceChange{Key: preferenceschema.KeyPaletteSaturationLight, Value: 50},
		AppPreferenceChange{Key: preferenceschema.KeyPaletteBrightnessLight, Value: -15},
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
		AppPreferenceChange{Key: preferenceschema.KeyPaletteHueLight, Value: 400},
		AppPreferenceChange{Key: preferenceschema.KeyPaletteSaturationLight, Value: 150},
		AppPreferenceChange{Key: preferenceschema.KeyPaletteBrightnessLight, Value: 80},
	))
	require.Equal(t, 360, app.Preferences.appSettings.PaletteHueLight)
	require.Equal(t, 100, app.Preferences.appSettings.PaletteSaturationLight)
	require.Equal(t, 50, app.Preferences.appSettings.PaletteBrightnessLight)

	// Values below min are clamped (dark mode).
	require.NoError(t, updatePreferences(app.Preferences,
		AppPreferenceChange{Key: preferenceschema.KeyPaletteHueDark, Value: -10},
		AppPreferenceChange{Key: preferenceschema.KeyPaletteSaturationDark, Value: -5},
		AppPreferenceChange{Key: preferenceschema.KeyPaletteBrightnessDark, Value: -100},
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
			Refresh:                  &settingsRefresh{Auto: true, MetricsIntervalMs: preferenceschema.DefaultMetricsRefreshIntervalMs},
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
	require.NoError(t, updatePreference(app.Preferences, preferenceschema.KeyAccentColorLight, "#ff5733"))
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
	err := updatePreference(app.Preferences, preferenceschema.KeyAccentColorLight, "ff5733")
	require.Error(t, err)
	require.Contains(t, err.Error(), "invalid color format")

	// Short hex returns error.
	err = updatePreference(app.Preferences, preferenceschema.KeyAccentColorLight, "#fff")
	require.Error(t, err)
	require.Contains(t, err.Error(), "invalid color format")

	// Non-hex characters return error.
	err = updatePreference(app.Preferences, preferenceschema.KeyAccentColorDark, "#zzzzzz")
	require.Error(t, err)
	require.Contains(t, err.Error(), "invalid color format")

	// Empty string is accepted (reset).
	require.NoError(t, updatePreference(app.Preferences, preferenceschema.KeyAccentColorDark, ""))
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
	require.Equal(t, preferenceschema.DefaultTablePageSize, settings.Preferences.DefaultTablePageSize)

	// A listed size persists and survives a reload.
	response, err := app.Preferences.UpdateAppPreferences(UpdateAppPreferencesRequest{Changes: []AppPreferenceChange{
		{Key: preferenceschema.KeyDefaultTablePageSize, Value: 250},
	}})
	require.NoError(t, err)
	require.Equal(t, 250, response.Settings.DefaultTablePageSize)
	app.Preferences.appSettings = nil
	ensurePreferencesLoaded(t, app.Preferences)
	require.Equal(t, 250, app.Preferences.appSettings.DefaultTablePageSize)

	// The sizes are a fixed list: anything else, fractions included, becomes the
	// default, as the pagination footers and the Settings dropdown do.
	for _, value := range []any{37, 999999, 25.5, 100.5} {
		require.NoError(t, updatePreference(app.Preferences, preferenceschema.KeyDefaultTablePageSize, 250))
		response, err = app.Preferences.UpdateAppPreferences(UpdateAppPreferencesRequest{Changes: []AppPreferenceChange{
			{Key: preferenceschema.KeyDefaultTablePageSize, Value: value},
		}})
		require.NoError(t, err)
		require.Equal(t, preferenceschema.DefaultTablePageSize, response.Settings.DefaultTablePageSize, "page size %v", value)
	}

	// An import with an off-list size imports the default.
	for _, value := range []int{37, 999999} {
		preferences := defaultSettingsFile().Preferences
		preferences.DefaultTablePageSize = value
		data, err := json.Marshal(settingsDataFile{
			Format:                settingsDataFormat,
			SchemaVersion:         settingsDataSchemaVersion,
			Preferences:           preferences,
			KubeconfigSearchPaths: []string{"/portable/kubeconfigs"},
		})
		require.NoError(t, err)
		document, _, err := decodeSettingsDataFile(data)
		require.NoError(t, err)
		require.Equal(t, preferenceschema.DefaultTablePageSize, document.Preferences.DefaultTablePageSize, "imported page size %d", value)
	}
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

// Settings files and exports written while the "Refresh background clusters"
// preference existed still carry preferences.refresh.background. They must load
// with every other preference intact, and the next save drops the key.
func TestSettingsFileWithRemovedBackgroundRefreshKeyStillLoads(t *testing.T) {
	setTestConfigEnv(t)
	app := newSettingsEffectsTestFixture(t)
	configPath, err := app.Preferences.getSettingsFilePath()
	require.NoError(t, err)
	legacy := []byte(`{"schemaVersion":1,"preferences":{"appearanceMode":"dark","refresh":{"auto":false,"background":true,"metricsIntervalMs":7000}}}`)
	writeTestFileWithParents(t, configPath, legacy, 0o644)

	ensurePreferencesLoaded(t, app.Preferences)
	require.False(t, app.Preferences.appSettings.AutoRefreshEnabled)
	require.Equal(t, "dark", app.Preferences.appSettings.AppearanceMode)

	require.NoError(t, updatePreference(app.Preferences, preferenceschema.KeyAutoRefreshEnabled, true))
	saved, err := os.ReadFile(configPath)
	require.NoError(t, err)
	require.NotContains(t, string(saved), `"background"`)
}
