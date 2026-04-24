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
		Theme:                                    "dark",
		SelectedKubeconfigs:                      []string{"/tmp/config:ctx"},
		UseShortResourceNames:                    true,
		AutoRefreshEnabled:                       false,
		RefreshBackgroundClustersEnabled:         false,
		MetricsRefreshIntervalMs:                 7000,
		MaxTableRows:                             2500,
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
		AccentColorLight:                         "#0d9488",
		AccentColorDark:                          "#f59e0b",
	}

	require.NoError(t, app.saveAppSettings())

	app.appSettings = nil
	require.NoError(t, app.loadAppSettings())
	require.Equal(t, "dark", app.appSettings.Theme)
	require.True(t, app.appSettings.UseShortResourceNames)
	require.Equal(t, []string{"/tmp/config:ctx"}, app.appSettings.SelectedKubeconfigs)
	require.False(t, app.appSettings.AutoRefreshEnabled)
	require.False(t, app.appSettings.RefreshBackgroundClustersEnabled)
	require.Equal(t, 7000, app.appSettings.MetricsRefreshIntervalMs)
	require.Equal(t, 2500, app.appSettings.MaxTableRows)
	require.Equal(t, 2500, app.appSettings.ObjPanelLogsBufferMaxSize)
	require.Equal(t, 144, app.appSettings.ObjPanelLogsTargetPerScopeLimit)
	require.Equal(t, 180, app.appSettings.ObjPanelLogsTargetGlobalLimit)
	require.Equal(t, "HH:mm:ss.SSS", app.appSettings.ObjPanelLogsAPITimestampFormat)
	require.True(t, app.appSettings.ObjPanelLogsAPITimestampUseLocalTimeZone)
	require.Equal(t, "namespaced", app.appSettings.GridTablePersistenceMode)
	require.Equal(t, "floating", app.appSettings.DefaultObjectPanelPosition)
	require.Equal(t, 200, app.appSettings.PaletteHueLight)
	require.Equal(t, 60, app.appSettings.PaletteSaturationLight)
	require.Equal(t, -20, app.appSettings.PaletteBrightnessLight)
	require.Equal(t, 120, app.appSettings.PaletteHueDark)
	require.Equal(t, 40, app.appSettings.PaletteSaturationDark)
	require.Equal(t, 10, app.appSettings.PaletteBrightnessDark)
	require.Equal(t, "#0d9488", app.appSettings.AccentColorLight)
	require.Equal(t, "#f59e0b", app.appSettings.AccentColorDark)
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

func TestAppSetObjPanelLogsBufferMaxSizePersistsAndClamps(t *testing.T) {
	setTestConfigEnv(t)

	// In-range value round-trips unchanged.
	app := newTestAppWithDefaults(t)
	require.NoError(t, app.SetObjPanelLogsBufferMaxSize(2500))
	require.Equal(t, 2500, app.appSettings.ObjPanelLogsBufferMaxSize)

	app.appSettings = nil
	require.NoError(t, app.loadAppSettings())
	require.Equal(t, 2500, app.appSettings.ObjPanelLogsBufferMaxSize)

	entries := app.logger.GetEntries()
	require.NotEmpty(t, entries)
	require.Contains(t, entries[len(entries)-1].Message, "ObjPanelLogs buffer max size changed to: 2500")

	// Out-of-range values clamp to the allowed range.
	require.NoError(t, app.SetObjPanelLogsBufferMaxSize(50))
	require.Equal(t, minObjPanelLogsBufferMaxSize, app.appSettings.ObjPanelLogsBufferMaxSize)

	require.NoError(t, app.SetObjPanelLogsBufferMaxSize(50000))
	require.Equal(t, maxObjPanelLogsBufferMaxSize, app.appSettings.ObjPanelLogsBufferMaxSize)

	// Default is returned when the settings file has no entry yet.
	setTestConfigEnv(t)
	freshApp := newTestAppWithDefaults(t)
	settings, err := freshApp.GetAppSettings()
	require.NoError(t, err)
	require.Equal(t, defaultObjPanelLogsBufferMaxSize, settings.ObjPanelLogsBufferMaxSize)
	require.Equal(t, defaultObjPanelLogsTargetPerScopeLimit, settings.ObjPanelLogsTargetPerScopeLimit)
	require.Equal(t, defaultObjPanelLogsTargetGlobalLimit, settings.ObjPanelLogsTargetGlobalLimit)
	require.Equal(t, defaultObjPanelLogsAPITimestampFormat, settings.ObjPanelLogsAPITimestampFormat)
	require.False(t, settings.ObjPanelLogsAPITimestampUseLocalTimeZone)
}

func TestAppSetMaxTableRowsPersistsAndClamps(t *testing.T) {
	setTestConfigEnv(t)

	app := newTestAppWithDefaults(t)
	require.NoError(t, app.SetMaxTableRows(2500))
	require.Equal(t, 2500, app.appSettings.MaxTableRows)

	app.appSettings = nil
	require.NoError(t, app.loadAppSettings())
	require.Equal(t, 2500, app.appSettings.MaxTableRows)

	entries := app.logger.GetEntries()
	require.NotEmpty(t, entries)
	require.Contains(t, entries[len(entries)-1].Message, "Max table rows changed to: 2500")

	require.NoError(t, app.SetMaxTableRows(50))
	require.Equal(t, minMaxTableRows, app.appSettings.MaxTableRows)

	require.NoError(t, app.SetMaxTableRows(50000))
	require.Equal(t, maxMaxTableRows, app.appSettings.MaxTableRows)

	setTestConfigEnv(t)
	freshApp := newTestAppWithDefaults(t)
	settings, err := freshApp.GetAppSettings()
	require.NoError(t, err)
	require.Equal(t, defaultMaxTableRows, settings.MaxTableRows)
}

func TestAppSetObjPanelLogsTargetPerScopeLimitPersistsAndClamps(t *testing.T) {
	setTestConfigEnv(t)

	app := newTestAppWithDefaults(t)
	require.NoError(t, app.SetObjPanelLogsTargetPerScopeLimit(144))
	require.Equal(t, 144, app.appSettings.ObjPanelLogsTargetPerScopeLimit)

	app.appSettings = nil
	require.NoError(t, app.loadAppSettings())
	require.Equal(t, 144, app.appSettings.ObjPanelLogsTargetPerScopeLimit)

	entries := app.logger.GetEntries()
	require.NotEmpty(t, entries)
	require.Contains(t, entries[len(entries)-1].Message, "Object Panel Logs Tab target per-scope limit changed to: 144")

	require.NoError(t, app.SetObjPanelLogsTargetPerScopeLimit(0))
	require.Equal(t, minObjPanelLogsTargetPerScopeLimit, app.appSettings.ObjPanelLogsTargetPerScopeLimit)

	require.NoError(t, app.SetObjPanelLogsTargetPerScopeLimit(999_999))
	require.Equal(t, maxObjPanelLogsTargetPerScopeLimit, app.appSettings.ObjPanelLogsTargetPerScopeLimit)
}

func TestAppSetObjPanelLogsTargetGlobalLimitPersistsAndClamps(t *testing.T) {
	setTestConfigEnv(t)

	app := newTestAppWithDefaults(t)
	require.NoError(t, app.SetObjPanelLogsTargetGlobalLimit(180))
	require.Equal(t, 180, app.appSettings.ObjPanelLogsTargetGlobalLimit)

	app.appSettings = nil
	require.NoError(t, app.loadAppSettings())
	require.Equal(t, 180, app.appSettings.ObjPanelLogsTargetGlobalLimit)

	entries := app.logger.GetEntries()
	require.NotEmpty(t, entries)
	require.Contains(t, entries[len(entries)-1].Message, "Object Panel Logs Tab target global limit changed to: 180")

	require.NoError(t, app.SetObjPanelLogsTargetGlobalLimit(0))
	require.Equal(t, minObjPanelLogsTargetGlobalLimit, app.appSettings.ObjPanelLogsTargetGlobalLimit)

	require.NoError(t, app.SetObjPanelLogsTargetGlobalLimit(999_999))
	require.Equal(t, maxObjPanelLogsTargetGlobalLimit, app.appSettings.ObjPanelLogsTargetGlobalLimit)
}

func TestAppSetObjPanelLogsAPITimestampFormatPersists(t *testing.T) {
	setTestConfigEnv(t)

	app := newTestAppWithDefaults(t)
	require.NoError(t, app.SetObjPanelLogsAPITimestampFormat("HH:mm:ss.SSS"))
	require.Equal(t, "HH:mm:ss.SSS", app.appSettings.ObjPanelLogsAPITimestampFormat)

	app.appSettings = nil
	require.NoError(t, app.loadAppSettings())
	require.Equal(t, "HH:mm:ss.SSS", app.appSettings.ObjPanelLogsAPITimestampFormat)

	entries := app.logger.GetEntries()
	require.NotEmpty(t, entries)
	require.Contains(t, entries[len(entries)-1].Message, "Object Panel Logs Tab API timestamp format changed to: HH:mm:ss.SSS")

	require.NoError(t, app.SetObjPanelLogsAPITimestampFormat(""))
	require.Equal(t, defaultObjPanelLogsAPITimestampFormat, app.appSettings.ObjPanelLogsAPITimestampFormat)
}

func TestAppSetObjPanelLogsAPITimestampUseLocalTimeZonePersists(t *testing.T) {
	setTestConfigEnv(t)

	app := newTestAppWithDefaults(t)
	require.NoError(t, app.SetObjPanelLogsAPITimestampUseLocalTimeZone(true))
	require.True(t, app.appSettings.ObjPanelLogsAPITimestampUseLocalTimeZone)

	app.appSettings = nil
	require.NoError(t, app.loadAppSettings())
	require.True(t, app.appSettings.ObjPanelLogsAPITimestampUseLocalTimeZone)

	entries := app.logger.GetEntries()
	require.NotEmpty(t, entries)
	require.Contains(
		t,
		entries[len(entries)-1].Message,
		"Object Panel Logs Tab API timestamp local timezone changed to: true",
	)
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

func TestAppSetDefaultObjectPanelPositionPersists(t *testing.T) {
	setTestConfigEnv(t)
	app := newTestAppWithDefaults(t)

	require.NoError(t, app.SetDefaultObjectPanelPosition("bottom"))
	require.Equal(t, "bottom", app.appSettings.DefaultObjectPanelPosition)

	app.appSettings = nil
	require.NoError(t, app.loadAppSettings())
	require.Equal(t, "bottom", app.appSettings.DefaultObjectPanelPosition)

	entries := app.logger.GetEntries()
	require.NotEmpty(t, entries)
	last := entries[len(entries)-1]
	require.Contains(t, last.Message, "Default object panel position changed to: bottom")
}

func TestAppSetDefaultObjectPanelPositionRejectsInvalidValues(t *testing.T) {
	setTestConfigEnv(t)
	app := newTestAppWithDefaults(t)

	err := app.SetDefaultObjectPanelPosition("invalid")
	require.Error(t, err)
	require.Contains(t, err.Error(), "invalid default object panel position")
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
	require.Equal(t, "", settings.Preferences.DefaultObjectPanelPosition)
	require.Equal(t, defaultKubeconfigSearchPaths(), settings.Kubeconfig.SearchPaths)
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

func TestAppSetPaletteTintPersistsAndClamps(t *testing.T) {
	setTestConfigEnv(t)
	app := newTestAppWithDefaults(t)

	// Normal values persist correctly for light theme.
	require.NoError(t, app.SetPaletteTint("light", 220, 50, -15))
	require.Equal(t, 220, app.appSettings.PaletteHueLight)
	require.Equal(t, 50, app.appSettings.PaletteSaturationLight)
	require.Equal(t, -15, app.appSettings.PaletteBrightnessLight)
	// Dark theme remains untouched.
	require.Equal(t, 0, app.appSettings.PaletteHueDark)
	require.Equal(t, 0, app.appSettings.PaletteSaturationDark)
	require.Equal(t, 0, app.appSettings.PaletteBrightnessDark)

	// Round-trips through save/load.
	app.appSettings = nil
	require.NoError(t, app.loadAppSettings())
	require.Equal(t, 220, app.appSettings.PaletteHueLight)
	require.Equal(t, 50, app.appSettings.PaletteSaturationLight)
	require.Equal(t, -15, app.appSettings.PaletteBrightnessLight)

	// Logs the change.
	entries := app.logger.GetEntries()
	require.NotEmpty(t, entries)
	last := entries[len(entries)-1]
	require.Equal(t, "INFO", last.Level)
	require.Contains(t, last.Message, "Palette tint (light) changed to hue=220 saturation=50 brightness=-15")
}

func TestAppSetPaletteTintClampsOutOfRange(t *testing.T) {
	setTestConfigEnv(t)
	app := newTestAppWithDefaults(t)

	// Values above max are clamped (light theme).
	require.NoError(t, app.SetPaletteTint("light", 400, 150, 80))
	require.Equal(t, 360, app.appSettings.PaletteHueLight)
	require.Equal(t, 100, app.appSettings.PaletteSaturationLight)
	require.Equal(t, 50, app.appSettings.PaletteBrightnessLight)

	// Values below min are clamped (dark theme).
	require.NoError(t, app.SetPaletteTint("dark", -10, -5, -100))
	require.Equal(t, 0, app.appSettings.PaletteHueDark)
	require.Equal(t, 0, app.appSettings.PaletteSaturationDark)
	require.Equal(t, -50, app.appSettings.PaletteBrightnessDark)
}

func TestAppSetPaletteTintDefaultsToZero(t *testing.T) {
	setTestConfigEnv(t)
	app := newTestAppWithDefaults(t)

	settings, err := app.GetAppSettings()
	require.NoError(t, err)
	require.Equal(t, 0, settings.PaletteHueLight)
	require.Equal(t, 0, settings.PaletteSaturationLight)
	require.Equal(t, 0, settings.PaletteBrightnessLight)
	require.Equal(t, 0, settings.PaletteHueDark)
	require.Equal(t, 0, settings.PaletteSaturationDark)
	require.Equal(t, 0, settings.PaletteBrightnessDark)
}

func TestAppSetPaletteTintRejectsInvalidTheme(t *testing.T) {
	setTestConfigEnv(t)
	app := newTestAppWithDefaults(t)

	err := app.SetPaletteTint("blue", 100, 50, 10)
	require.Error(t, err)
	require.Contains(t, err.Error(), "invalid palette theme")
}

func TestAppPaletteTintMigration(t *testing.T) {
	setTestConfigEnv(t)
	app := newTestAppWithDefaults(t)

	// Write an old-format settings file with single-value palette fields.
	configPath, err := app.getSettingsFilePath()
	require.NoError(t, err)

	oldSettings := &settingsFile{
		SchemaVersion: settingsSchemaVersion,
		Preferences: settingsPreferences{
			Theme:                    "system",
			GridTablePersistenceMode: "shared",
			PaletteHue:               180,
			PaletteSaturation:        65,
			PaletteBrightness:        -10,
			Refresh:                  &settingsRefresh{Auto: true, Background: true, MetricsIntervalMs: defaultMetricsIntervalMs()},
		},
	}
	bytes, err := json.Marshal(oldSettings)
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(configPath, bytes, 0o644))

	// Load and verify migration copies old values to both themes.
	require.NoError(t, app.loadAppSettings())
	require.Equal(t, 180, app.appSettings.PaletteHueLight)
	require.Equal(t, 65, app.appSettings.PaletteSaturationLight)
	require.Equal(t, -10, app.appSettings.PaletteBrightnessLight)
	require.Equal(t, 180, app.appSettings.PaletteHueDark)
	require.Equal(t, 65, app.appSettings.PaletteSaturationDark)
	require.Equal(t, -10, app.appSettings.PaletteBrightnessDark)
}

func TestAppSetAccentColorPersists(t *testing.T) {
	setTestConfigEnv(t)
	app := newTestAppWithDefaults(t)

	// Set light accent color.
	require.NoError(t, app.SetAccentColor("light", "#ff5733"))
	require.Equal(t, "#ff5733", app.appSettings.AccentColorLight)
	// Dark theme remains untouched.
	require.Equal(t, "", app.appSettings.AccentColorDark)

	// Round-trips through save/load.
	app.appSettings = nil
	require.NoError(t, app.loadAppSettings())
	require.Equal(t, "#ff5733", app.appSettings.AccentColorLight)
	require.Equal(t, "", app.appSettings.AccentColorDark)

	// Logs the change.
	entries := app.logger.GetEntries()
	require.NotEmpty(t, entries)
	last := entries[len(entries)-1]
	require.Equal(t, "INFO", last.Level)
	require.Contains(t, last.Message, "Accent color (light) changed to: #ff5733")
}

func TestAppSetAccentColorValidation(t *testing.T) {
	setTestConfigEnv(t)
	app := newTestAppWithDefaults(t)

	// Invalid theme returns error.
	err := app.SetAccentColor("blue", "#ff5733")
	require.Error(t, err)
	require.Contains(t, err.Error(), "invalid accent color theme")

	// Invalid hex format returns error.
	err = app.SetAccentColor("light", "ff5733")
	require.Error(t, err)
	require.Contains(t, err.Error(), "invalid accent color format")

	// Short hex returns error.
	err = app.SetAccentColor("light", "#fff")
	require.Error(t, err)
	require.Contains(t, err.Error(), "invalid accent color format")

	// Non-hex characters return error.
	err = app.SetAccentColor("dark", "#zzzzzz")
	require.Error(t, err)
	require.Contains(t, err.Error(), "invalid accent color format")

	// Empty string is accepted (reset).
	require.NoError(t, app.SetAccentColor("dark", ""))
	require.Equal(t, "", app.appSettings.AccentColorDark)
}
