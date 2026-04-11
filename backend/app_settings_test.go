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
		Theme:                            "dark",
		SelectedKubeconfigs:              []string{"/tmp/config:ctx"},
		UseShortResourceNames:            true,
		AutoRefreshEnabled:               false,
		RefreshBackgroundClustersEnabled: false,
		MetricsRefreshIntervalMs:         7000,
		LogBufferMaxSize:                 2500,
		LogTargetPerScopeLimit:           144,
		LogTargetGlobalLimit:             180,
		LogAPITimestampFormat:            "HH:mm:ss.SSS",
		LogAPITimestampUseLocalTimeZone:  true,
		GridTablePersistenceMode:         "namespaced",
		DefaultObjectPanelPosition:       "floating",
		PaletteHueLight:                  200,
		PaletteSaturationLight:           60,
		PaletteBrightnessLight:           -20,
		PaletteHueDark:                   120,
		PaletteSaturationDark:            40,
		PaletteBrightnessDark:            10,
		AccentColorLight:                 "#0d9488",
		AccentColorDark:                  "#f59e0b",
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
	require.Equal(t, 2500, app.appSettings.LogBufferMaxSize)
	require.Equal(t, 144, app.appSettings.LogTargetPerScopeLimit)
	require.Equal(t, 180, app.appSettings.LogTargetGlobalLimit)
	require.Equal(t, "HH:mm:ss.SSS", app.appSettings.LogAPITimestampFormat)
	require.True(t, app.appSettings.LogAPITimestampUseLocalTimeZone)
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

func TestAppSetLogBufferMaxSizePersistsAndClamps(t *testing.T) {
	setTestConfigEnv(t)

	// In-range value round-trips unchanged.
	app := newTestAppWithDefaults(t)
	require.NoError(t, app.SetLogBufferMaxSize(2500))
	require.Equal(t, 2500, app.appSettings.LogBufferMaxSize)

	app.appSettings = nil
	require.NoError(t, app.loadAppSettings())
	require.Equal(t, 2500, app.appSettings.LogBufferMaxSize)

	entries := app.logger.GetEntries()
	require.NotEmpty(t, entries)
	require.Contains(t, entries[len(entries)-1].Message, "Log buffer max size changed to: 2500")

	// Out-of-range values clamp to the allowed range.
	require.NoError(t, app.SetLogBufferMaxSize(50))
	require.Equal(t, minLogBufferMaxSize, app.appSettings.LogBufferMaxSize)

	require.NoError(t, app.SetLogBufferMaxSize(50000))
	require.Equal(t, maxLogBufferMaxSize, app.appSettings.LogBufferMaxSize)

	// Default is returned when the settings file has no entry yet.
	setTestConfigEnv(t)
	freshApp := newTestAppWithDefaults(t)
	settings, err := freshApp.GetAppSettings()
	require.NoError(t, err)
	require.Equal(t, defaultLogBufferMaxSize, settings.LogBufferMaxSize)
	require.Equal(t, defaultLogTargetPerScopeLimit, settings.LogTargetPerScopeLimit)
	require.Equal(t, defaultLogTargetGlobalLimit, settings.LogTargetGlobalLimit)
	require.Equal(t, defaultLogAPITimestampFormat, settings.LogAPITimestampFormat)
	require.False(t, settings.LogAPITimestampUseLocalTimeZone)
}

func TestAppSetLogTargetPerScopeLimitPersistsAndClamps(t *testing.T) {
	setTestConfigEnv(t)

	app := newTestAppWithDefaults(t)
	require.NoError(t, app.SetLogTargetPerScopeLimit(144))
	require.Equal(t, 144, app.appSettings.LogTargetPerScopeLimit)

	app.appSettings = nil
	require.NoError(t, app.loadAppSettings())
	require.Equal(t, 144, app.appSettings.LogTargetPerScopeLimit)

	entries := app.logger.GetEntries()
	require.NotEmpty(t, entries)
	require.Contains(t, entries[len(entries)-1].Message, "Log target per-scope limit changed to: 144")

	require.NoError(t, app.SetLogTargetPerScopeLimit(0))
	require.Equal(t, minLogTargetPerScopeLimit, app.appSettings.LogTargetPerScopeLimit)

	require.NoError(t, app.SetLogTargetPerScopeLimit(999_999))
	require.Equal(t, maxLogTargetPerScopeLimit, app.appSettings.LogTargetPerScopeLimit)
}

func TestAppSetLogTargetGlobalLimitPersistsAndClamps(t *testing.T) {
	setTestConfigEnv(t)

	app := newTestAppWithDefaults(t)
	require.NoError(t, app.SetLogTargetGlobalLimit(180))
	require.Equal(t, 180, app.appSettings.LogTargetGlobalLimit)

	app.appSettings = nil
	require.NoError(t, app.loadAppSettings())
	require.Equal(t, 180, app.appSettings.LogTargetGlobalLimit)

	entries := app.logger.GetEntries()
	require.NotEmpty(t, entries)
	require.Contains(t, entries[len(entries)-1].Message, "Log target global limit changed to: 180")

	require.NoError(t, app.SetLogTargetGlobalLimit(0))
	require.Equal(t, minLogTargetGlobalLimit, app.appSettings.LogTargetGlobalLimit)

	require.NoError(t, app.SetLogTargetGlobalLimit(999_999))
	require.Equal(t, maxLogTargetGlobalLimit, app.appSettings.LogTargetGlobalLimit)
}

func TestAppSetLogAPITimestampFormatPersists(t *testing.T) {
	setTestConfigEnv(t)

	app := newTestAppWithDefaults(t)
	require.NoError(t, app.SetLogAPITimestampFormat("HH:mm:ss.SSS"))
	require.Equal(t, "HH:mm:ss.SSS", app.appSettings.LogAPITimestampFormat)

	app.appSettings = nil
	require.NoError(t, app.loadAppSettings())
	require.Equal(t, "HH:mm:ss.SSS", app.appSettings.LogAPITimestampFormat)

	entries := app.logger.GetEntries()
	require.NotEmpty(t, entries)
	require.Contains(t, entries[len(entries)-1].Message, "Log API timestamp format changed to: HH:mm:ss.SSS")

	require.NoError(t, app.SetLogAPITimestampFormat(""))
	require.Equal(t, defaultLogAPITimestampFormat, app.appSettings.LogAPITimestampFormat)
}

func TestAppSetLogAPITimestampUseLocalTimeZonePersists(t *testing.T) {
	setTestConfigEnv(t)

	app := newTestAppWithDefaults(t)
	require.NoError(t, app.SetLogAPITimestampUseLocalTimeZone(true))
	require.True(t, app.appSettings.LogAPITimestampUseLocalTimeZone)

	app.appSettings = nil
	require.NoError(t, app.loadAppSettings())
	require.True(t, app.appSettings.LogAPITimestampUseLocalTimeZone)

	entries := app.logger.GetEntries()
	require.NotEmpty(t, entries)
	require.Contains(
		t,
		entries[len(entries)-1].Message,
		"Log API timestamp local timezone changed to: true",
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
