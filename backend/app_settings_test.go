package backend

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"k8s.io/client-go/rest"
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
			AppearanceMode:           "system",
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
		AppearanceMode:                           "dark",
		SelectedKubeconfigs:                      []string{"/tmp/config:ctx"},
		UseShortResourceNames:                    true,
		DimInactiveNamespaces:                    false,
		ExclusiveNamespaces:                      false,
		AutoRefreshEnabled:                       false,
		RefreshBackgroundClustersEnabled:         false,
		MetricsRefreshIntervalMs:                 7000,
		MaxTableRows:                             2500,
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

	require.NoError(t, app.saveAppSettings())
	configPath, err := app.getSettingsFilePath()
	require.NoError(t, err)
	savedBytes, err := os.ReadFile(configPath)
	require.NoError(t, err)
	require.Contains(t, string(savedBytes), `"appearanceMode":"dark"`)
	require.NotContains(t, string(savedBytes), `"theme":"dark"`)

	app.appSettings = nil
	require.NoError(t, app.loadAppSettings())
	require.Equal(t, "dark", app.appSettings.AppearanceMode)
	require.True(t, app.appSettings.UseShortResourceNames)
	require.False(t, app.appSettings.DimInactiveNamespaces)
	require.False(t, app.appSettings.ExclusiveNamespaces)
	require.Equal(t, []string{"/tmp/config:ctx"}, app.appSettings.SelectedKubeconfigs)
	require.False(t, app.appSettings.AutoRefreshEnabled)
	require.False(t, app.appSettings.RefreshBackgroundClustersEnabled)
	require.Equal(t, 7000, app.appSettings.MetricsRefreshIntervalMs)
	require.Equal(t, 2500, app.appSettings.MaxTableRows)
	require.Equal(t, 250, app.appSettings.KubernetesClientQPS)
	require.Equal(t, 500, app.appSettings.KubernetesClientBurst)
	require.Equal(t, 16, app.appSettings.PermissionSSRRFetchConcurrency)
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
	require.Equal(t, "#326ce5.", app.appSettings.AccentColorLight)
	require.Equal(t, "#f59e0b", app.appSettings.AccentColorDark)
}

func TestAppSetAppearanceModePersistsAndLogs(t *testing.T) {
	setTestConfigEnv(t)
	app := newTestAppWithDefaults(t)

	require.NoError(t, app.SetAppearanceMode("dark"))
	require.Equal(t, "dark", app.appSettings.AppearanceMode)

	app.appSettings = nil
	require.NoError(t, app.loadAppSettings())
	require.Equal(t, "dark", app.appSettings.AppearanceMode)

	entries := app.logger.GetEntries()
	require.NotEmpty(t, entries)
	last := entries[len(entries)-1]
	require.Equal(t, "INFO", last.Level)
	require.Contains(t, last.Message, "Appearance mode changed to: dark")
}

func TestAppSetAppearanceModeRejectsInvalidValues(t *testing.T) {
	setTestConfigEnv(t)
	app := newTestAppWithDefaults(t)

	err := app.SetAppearanceMode("blue")
	require.Error(t, err)
	require.Contains(t, err.Error(), "invalid appearance mode")
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

func TestAppSetDimInactiveNamespacesPersists(t *testing.T) {
	setTestConfigEnv(t)
	app := newTestAppWithDefaults(t)

	settings, err := app.GetAppSettings()
	require.NoError(t, err)
	require.True(t, settings.DimInactiveNamespaces)

	require.NoError(t, app.SetDimInactiveNamespaces(false))
	require.False(t, app.appSettings.DimInactiveNamespaces)

	app.appSettings = nil
	require.NoError(t, app.loadAppSettings())
	require.False(t, app.appSettings.DimInactiveNamespaces)

	entries := app.logger.GetEntries()
	require.NotEmpty(t, entries)
	last := entries[len(entries)-1]
	require.Equal(t, "INFO", last.Level)
	require.Contains(t, last.Message, "Dim inactive namespaces changed to: false")
}

func TestAppSetExclusiveNamespacesPersists(t *testing.T) {
	setTestConfigEnv(t)
	app := newTestAppWithDefaults(t)

	settings, err := app.GetAppSettings()
	require.NoError(t, err)
	require.True(t, settings.ExclusiveNamespaces)

	require.NoError(t, app.SetExclusiveNamespaces(false))
	require.False(t, app.appSettings.ExclusiveNamespaces)

	app.appSettings = nil
	require.NoError(t, app.loadAppSettings())
	require.False(t, app.appSettings.ExclusiveNamespaces)

	entries := app.logger.GetEntries()
	require.NotEmpty(t, entries)
	last := entries[len(entries)-1]
	require.Equal(t, "INFO", last.Level)
	require.Contains(t, last.Message, "Exclusive namespaces changed to: false")
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

func TestAppSetKubernetesAPISettingsPersistAndClamp(t *testing.T) {
	setTestConfigEnv(t)

	app := newTestAppWithDefaults(t)
	require.NoError(t, app.SetKubernetesClientQPS(250))
	require.NoError(t, app.SetKubernetesClientBurst(500))
	require.NoError(t, app.SetPermissionSSRRFetchConcurrency(16))
	require.Equal(t, 250, app.appSettings.KubernetesClientQPS)
	require.Equal(t, 500, app.appSettings.KubernetesClientBurst)
	require.Equal(t, 16, app.appSettings.PermissionSSRRFetchConcurrency)

	app.appSettings = nil
	require.NoError(t, app.loadAppSettings())
	require.Equal(t, 250, app.appSettings.KubernetesClientQPS)
	require.Equal(t, 500, app.appSettings.KubernetesClientBurst)
	require.Equal(t, 16, app.appSettings.PermissionSSRRFetchConcurrency)

	require.NoError(t, app.SetKubernetesClientQPS(0))
	require.Equal(t, minKubernetesClientQPS, app.appSettings.KubernetesClientQPS)
	require.NoError(t, app.SetKubernetesClientQPS(999_999))
	require.Equal(t, maxKubernetesClientQPS, app.appSettings.KubernetesClientQPS)

	require.NoError(t, app.SetKubernetesClientBurst(0))
	require.Equal(t, minKubernetesClientBurst, app.appSettings.KubernetesClientBurst)
	require.NoError(t, app.SetKubernetesClientBurst(999_999))
	require.Equal(t, maxKubernetesClientBurst, app.appSettings.KubernetesClientBurst)

	require.NoError(t, app.SetPermissionSSRRFetchConcurrency(0))
	require.Equal(t, minPermissionSSRRFetchConcurrency, app.appSettings.PermissionSSRRFetchConcurrency)
	require.NoError(t, app.SetPermissionSSRRFetchConcurrency(999_999))
	require.Equal(t, maxPermissionSSRRFetchConcurrency, app.appSettings.PermissionSSRRFetchConcurrency)

	setTestConfigEnv(t)
	freshApp := newTestAppWithDefaults(t)
	settings, err := freshApp.GetAppSettings()
	require.NoError(t, err)
	require.Equal(t, defaultKubernetesClientQPS, settings.KubernetesClientQPS)
	require.Equal(t, defaultKubernetesClientBurst, settings.KubernetesClientBurst)
	require.Equal(t, defaultPermissionSSRRFetchConcurrency, settings.PermissionSSRRFetchConcurrency)
}

func TestAppSetKubernetesClientRateLimitsUpdatesExistingClients(t *testing.T) {
	setTestConfigEnv(t)

	app := newTestAppWithDefaults(t)
	app.kubeAPIMetrics = newKubernetesAPIMetricsRegistry()
	limiter := newMutableKubernetesRateLimiter(defaultKubernetesClientQPS, defaultKubernetesClientBurst)
	app.clusterClients = map[string]*clusterClients{
		"cluster-a": {
			meta:        ClusterMeta{ID: "cluster-a", Name: "Cluster A"},
			rateLimiter: limiter,
			restConfig:  &rest.Config{QPS: float32(defaultKubernetesClientQPS), Burst: defaultKubernetesClientBurst},
		},
	}
	app.kubeAPIMetrics.getOrCreate(ClusterMeta{ID: "cluster-a", Name: "Cluster A"}, defaultKubernetesClientQPS, defaultKubernetesClientBurst)

	require.NoError(t, app.SetKubernetesClientQPS(150))
	qps, burst := limiter.Limits()
	require.Equal(t, 150, qps)
	require.Equal(t, defaultKubernetesClientBurst, burst)
	require.Equal(t, float32(150), app.clusterClients["cluster-a"].restConfig.QPS)
	require.Equal(t, defaultKubernetesClientBurst, app.clusterClients["cluster-a"].restConfig.Burst)

	require.NoError(t, app.SetKubernetesClientBurst(450))
	qps, burst = limiter.Limits()
	require.Equal(t, 150, qps)
	require.Equal(t, 450, burst)
	require.Equal(t, float32(150), app.clusterClients["cluster-a"].restConfig.QPS)
	require.Equal(t, 450, app.clusterClients["cluster-a"].restConfig.Burst)

	rows := app.kubeAPIMetrics.snapshot(time.Now())
	require.Len(t, rows, 1)
	require.Equal(t, 150, rows[0].ConfiguredQPS)
	require.Equal(t, 450, rows[0].ConfiguredBurst)
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

func TestAppGetAppearanceModeInfoReflectsCurrentSettings(t *testing.T) {
	setTestConfigEnv(t)
	app := newTestAppWithDefaults(t)

	require.NoError(t, app.SetAppearanceMode("light"))
	info, err := app.GetAppearanceModeInfo()
	require.NoError(t, err)
	require.Equal(t, "light", info.CurrentMode)
	require.Equal(t, "light", info.UserMode)
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
	require.Equal(t, "system", settings.Preferences.AppearanceMode)
	require.NotNil(t, settings.Preferences.Refresh)
	require.True(t, settings.Preferences.Refresh.Auto)
	require.True(t, settings.Preferences.Refresh.Background)
	require.Equal(t, "shared", settings.Preferences.GridTablePersistenceMode)
	require.Equal(t, "", settings.Preferences.DefaultObjectPanelPosition)
	require.Equal(t, defaultKubeconfigSearchPaths(), settings.Kubeconfig.SearchPaths)
}

func TestLoadSettingsFileMigratesOldAppearanceModePreference(t *testing.T) {
	setTestConfigEnv(t)
	app := newTestAppWithDefaults(t)

	configPath, err := app.getSettingsFilePath()
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(configPath, []byte(`{"schemaVersion":1,"preferences":{"theme":"dark"}}`), 0o644))

	settings, err := app.loadSettingsFile()
	require.NoError(t, err)
	require.Equal(t, "dark", settings.Preferences.AppearanceMode)

	require.NoError(t, app.saveSettingsFile(settings))
	saved, err := os.ReadFile(configPath)
	require.NoError(t, err)
	require.Contains(t, string(saved), `"appearanceMode":"dark"`)
	require.NotContains(t, string(saved), `"theme":"dark"`)
}

func TestSaveSettingsFileOverwritesExistingData(t *testing.T) {
	// Verify subsequent saves overwrite previous settings on disk.
	setTestConfigEnv(t)
	app := newTestAppWithDefaults(t)

	settings, err := app.loadSettingsFile()
	require.NoError(t, err)

	settings.Preferences.AppearanceMode = "dark"
	require.NoError(t, app.saveSettingsFile(settings))

	settings.Preferences.AppearanceMode = "light"
	require.NoError(t, app.saveSettingsFile(settings))

	loaded, err := app.loadSettingsFile()
	require.NoError(t, err)
	require.Equal(t, "light", loaded.Preferences.AppearanceMode)
}

func TestAppSetPaletteTintPersistsAndClamps(t *testing.T) {
	setTestConfigEnv(t)
	app := newTestAppWithDefaults(t)

	// Normal values persist correctly for light mode.
	require.NoError(t, app.SetPaletteTint("light", 220, 50, -15))
	require.Equal(t, 220, app.appSettings.PaletteHueLight)
	require.Equal(t, 50, app.appSettings.PaletteSaturationLight)
	require.Equal(t, -15, app.appSettings.PaletteBrightnessLight)
	// Dark mode remains untouched.
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

	// Values above max are clamped (light mode).
	require.NoError(t, app.SetPaletteTint("light", 400, 150, 80))
	require.Equal(t, 360, app.appSettings.PaletteHueLight)
	require.Equal(t, 100, app.appSettings.PaletteSaturationLight)
	require.Equal(t, 50, app.appSettings.PaletteBrightnessLight)

	// Values below min are clamped (dark mode).
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

func TestAppSetPaletteTintRejectsInvalidMode(t *testing.T) {
	setTestConfigEnv(t)
	app := newTestAppWithDefaults(t)

	err := app.SetPaletteTint("blue", 100, 50, 10)
	require.Error(t, err)
	require.Contains(t, err.Error(), "invalid palette mode")
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
	require.NoError(t, os.WriteFile(configPath, bytes, 0o644))

	// Load and verify migration copies old values to both mode palettes.
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
	// Dark mode remains untouched.
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

	// Invalid mode returns error.
	err := app.SetAccentColor("blue", "#ff5733")
	require.Error(t, err)
	require.Contains(t, err.Error(), "invalid accent color mode")

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
