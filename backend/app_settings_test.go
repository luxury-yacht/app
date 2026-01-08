package backend

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func newTestAppWithDefaults(t *testing.T) *App {
	t.Helper()
	return &App{
		logger:         NewLogger(100),
		eventEmitter:   func(context.Context, string, ...interface{}) {},
		sidebarVisible: true,
		listenLoopback: defaultLoopbackListener,
	}
}

func setTestConfigEnv(t *testing.T) {
	t.Helper()
	baseDir := t.TempDir()
	t.Setenv("HOME", baseDir)
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(baseDir, ".config"))
	t.Setenv("APPDATA", filepath.Join(baseDir, "AppData", "Roaming"))
}

func TestAppGetConfigFilePathCreatesDirectory(t *testing.T) {
	setTestConfigEnv(t)
	app := newTestAppWithDefaults(t)

	path, err := app.getConfigFilePath()
	require.NoError(t, err)

	require.DirExists(t, filepath.Dir(path))
	require.Equal(t, "window-settings.json", filepath.Base(path))
}

func TestAppLoadWindowSettingsDefaultWhenMissing(t *testing.T) {
	setTestConfigEnv(t)
	app := newTestAppWithDefaults(t)

	settings, err := app.LoadWindowSettings()
	require.NoError(t, err)
	require.NotNil(t, settings)
	require.Equal(t, int(1200), settings.Width)
	require.Equal(t, int(800), settings.Height)
}

func TestAppLoadWindowSettingsReadsExistingFile(t *testing.T) {
	setTestConfigEnv(t)
	app := newTestAppWithDefaults(t)

	configPath, err := app.getSettingsFilePath()
	require.NoError(t, err)

	want := &WindowSettings{X: 10, Y: 20, Width: 900, Height: 600, Maximized: true}
	settings := &settingsFile{
		SchemaVersion: settingsSchemaVersion,
		UpdatedAt:     time.Now().UTC(),
		Preferences: settingsPreferences{
			Theme:                    "system",
			GridTablePersistenceMode: "shared",
		},
		UI: settingsUI{Window: *want},
	}
	bytes, err := json.Marshal(settings)
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(configPath, bytes, 0o644))

	got, err := app.LoadWindowSettings()
	require.NoError(t, err)
	require.Equal(t, want, got)
	require.Equal(t, want, app.windowSettings)
}

func TestAppGetAppSettingsReturnsDefaultWhenMissing(t *testing.T) {
	setTestConfigEnv(t)
	app := newTestAppWithDefaults(t)

	settings, err := app.GetAppSettings()
	require.NoError(t, err)
	require.Equal(t, getDefaultAppSettings(), settings)
	require.Equal(t, settings, app.appSettings)
}

func TestAppSaveAndLoadAppSettingsRoundTrip(t *testing.T) {
	setTestConfigEnv(t)
	app := newTestAppWithDefaults(t)

	app.appSettings = &AppSettings{
		Theme:                            "dark",
		SelectedKubeconfig:               "/tmp/config",
		UseShortResourceNames:            true,
		AutoRefreshEnabled:               false,
		RefreshBackgroundClustersEnabled: false,
		MetricsRefreshIntervalMs:         7000,
		GridTablePersistenceMode:         "namespaced",
	}

	require.NoError(t, app.saveAppSettings())

	app.appSettings = nil
	require.NoError(t, app.loadAppSettings())
	require.Equal(t, "dark", app.appSettings.Theme)
	require.True(t, app.appSettings.UseShortResourceNames)
	require.Equal(t, "/tmp/config", app.appSettings.SelectedKubeconfig)
	require.False(t, app.appSettings.AutoRefreshEnabled)
	require.False(t, app.appSettings.RefreshBackgroundClustersEnabled)
	require.Equal(t, 7000, app.appSettings.MetricsRefreshIntervalMs)
	require.Equal(t, "namespaced", app.appSettings.GridTablePersistenceMode)
}

func TestAppSetThemePersistsAndLogs(t *testing.T) {
	setTestConfigEnv(t)
	app := newTestAppWithDefaults(t)

	require.NoError(t, app.SetTheme("dark"))
	require.Equal(t, "dark", app.appSettings.Theme)

	app.appSettings = nil
	require.NoError(t, app.loadAppSettings())
	require.Equal(t, "dark", app.appSettings.Theme)

	entries := app.logger.GetEntries()
	require.NotEmpty(t, entries)
	last := entries[len(entries)-1]
	require.Equal(t, "INFO", last.Level)
	require.Contains(t, last.Message, "Theme changed to: dark")
}

func TestAppSetThemeRejectsInvalidValues(t *testing.T) {
	setTestConfigEnv(t)
	app := newTestAppWithDefaults(t)

	err := app.SetTheme("blue")
	require.Error(t, err)
	require.Contains(t, err.Error(), "invalid theme")
}

func TestAppSetUseShortResourceNamesPersists(t *testing.T) {
	setTestConfigEnv(t)
	app := newTestAppWithDefaults(t)

	require.NoError(t, app.SetUseShortResourceNames(true))
	require.True(t, app.appSettings.UseShortResourceNames)

	app.appSettings = nil
	require.NoError(t, app.loadAppSettings())
	require.True(t, app.appSettings.UseShortResourceNames)

	entries := app.logger.GetEntries()
	require.NotEmpty(t, entries)
	last := entries[len(entries)-1]
	require.Equal(t, "INFO", last.Level)
	require.Contains(t, last.Message, "Use short resource names changed to: true")
}

func TestAppSetAutoRefreshEnabledPersists(t *testing.T) {
	setTestConfigEnv(t)
	app := newTestAppWithDefaults(t)

	require.NoError(t, app.SetAutoRefreshEnabled(false))
	require.False(t, app.appSettings.AutoRefreshEnabled)

	app.appSettings = nil
	require.NoError(t, app.loadAppSettings())
	require.False(t, app.appSettings.AutoRefreshEnabled)

	entries := app.logger.GetEntries()
	require.NotEmpty(t, entries)
	last := entries[len(entries)-1]
	require.Equal(t, "INFO", last.Level)
	require.Contains(t, last.Message, "Auto refresh enabled changed to: false")
}

func TestAppSetBackgroundRefreshEnabledPersists(t *testing.T) {
	setTestConfigEnv(t)
	app := newTestAppWithDefaults(t)

	require.NoError(t, app.SetBackgroundRefreshEnabled(false))
	require.False(t, app.appSettings.RefreshBackgroundClustersEnabled)

	app.appSettings = nil
	require.NoError(t, app.loadAppSettings())
	require.False(t, app.appSettings.RefreshBackgroundClustersEnabled)

	entries := app.logger.GetEntries()
	require.NotEmpty(t, entries)
	last := entries[len(entries)-1]
	require.Equal(t, "INFO", last.Level)
	require.Contains(t, last.Message, "Background refresh enabled changed to: false")
}

func TestAppSetGridTablePersistenceModePersists(t *testing.T) {
	setTestConfigEnv(t)
	app := newTestAppWithDefaults(t)

	require.NoError(t, app.SetGridTablePersistenceMode("namespaced"))
	require.Equal(t, "namespaced", app.appSettings.GridTablePersistenceMode)

	app.appSettings = nil
	require.NoError(t, app.loadAppSettings())
	require.Equal(t, "namespaced", app.appSettings.GridTablePersistenceMode)

	entries := app.logger.GetEntries()
	require.NotEmpty(t, entries)
	last := entries[len(entries)-1]
	require.Equal(t, "INFO", last.Level)
	require.Contains(t, last.Message, "Grid table persistence mode changed to: namespaced")
}

func TestAppSetGridTablePersistenceModeRejectsInvalidValues(t *testing.T) {
	setTestConfigEnv(t)
	app := newTestAppWithDefaults(t)

	err := app.SetGridTablePersistenceMode("invalid")
	require.Error(t, err)
	require.Contains(t, err.Error(), "invalid grid table persistence mode")
}

func TestAppGetThemeInfoReflectsCurrentSettings(t *testing.T) {
	setTestConfigEnv(t)
	app := newTestAppWithDefaults(t)

	require.NoError(t, app.SetTheme("light"))
	info, err := app.GetThemeInfo()
	require.NoError(t, err)
	require.Equal(t, "light", info.CurrentTheme)
	require.Equal(t, "light", info.UserTheme)
}

func TestAppShowSettingsWarnsWhenContextNil(t *testing.T) {
	setTestConfigEnv(t)
	app := newTestAppWithDefaults(t)

	app.ShowSettings()

	entries := app.logger.GetEntries()
	require.NotEmpty(t, entries)
	last := entries[len(entries)-1]
	require.Equal(t, "WARN", last.Level)
	require.Contains(t, last.Message, "Cannot show settings")
}

func TestAppShowAboutWarnsWhenContextNil(t *testing.T) {
	setTestConfigEnv(t)
	app := newTestAppWithDefaults(t)

	app.ShowAbout()

	entries := app.logger.GetEntries()
	require.NotEmpty(t, entries)
	last := entries[len(entries)-1]
	require.Equal(t, "WARN", last.Level)
	require.Contains(t, last.Message, "Cannot show about")
}

func TestLoadSettingsFileNormalizesDefaults(t *testing.T) {
	// Ensure missing/zero fields are normalized to defaults after load.
	setTestConfigEnv(t)
	app := newTestAppWithDefaults(t)

	configPath, err := app.getSettingsFilePath()
	require.NoError(t, err)

	require.NoError(t, os.WriteFile(configPath, []byte(`{"schemaVersion":0}`), 0o644))

	settings, err := app.loadSettingsFile()
	require.NoError(t, err)
	require.Equal(t, settingsSchemaVersion, settings.SchemaVersion)
	require.Equal(t, "system", settings.Preferences.Theme)
	require.NotNil(t, settings.Preferences.Refresh)
	require.True(t, settings.Preferences.Refresh.Auto)
	require.True(t, settings.Preferences.Refresh.Background)
	require.Equal(t, "shared", settings.Preferences.GridTablePersistenceMode)
}

func TestSaveSettingsFileOverwritesExistingData(t *testing.T) {
	// Verify subsequent saves overwrite previous settings on disk.
	setTestConfigEnv(t)
	app := newTestAppWithDefaults(t)

	settings, err := app.loadSettingsFile()
	require.NoError(t, err)

	settings.Preferences.Theme = "dark"
	require.NoError(t, app.saveSettingsFile(settings))

	settings.Preferences.Theme = "light"
	require.NoError(t, app.saveSettingsFile(settings))

	loaded, err := app.loadSettingsFile()
	require.NoError(t, err)
	require.Equal(t, "light", loaded.Preferences.Theme)
}
