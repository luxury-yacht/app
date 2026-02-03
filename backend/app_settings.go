package backend

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

var (
	runtimeWindowGetPosition = runtime.WindowGetPosition
	runtimeWindowGetSize     = runtime.WindowGetSize
	runtimeWindowIsMaximised = runtime.WindowIsMaximised
)

const settingsSchemaVersion = 1

// settingsFile captures the persisted application settings stored in settings.json.
type settingsFile struct {
	SchemaVersion int                 `json:"schemaVersion"`
	UpdatedAt     time.Time           `json:"updatedAt"`
	Preferences   settingsPreferences `json:"preferences"`
	Kubeconfig    settingsKubeconfig  `json:"kubeconfig"`
	UI            settingsUI          `json:"ui"`
}

// settingsPreferences captures user-configurable preferences.
type settingsPreferences struct {
	Theme                    string           `json:"theme"`
	UseShortResourceNames    bool             `json:"useShortResourceNames"`
	Refresh                  *settingsRefresh `json:"refresh"`
	GridTablePersistenceMode string           `json:"gridTablePersistenceMode"`
}

// settingsRefresh captures user-configurable refresh settings.
type settingsRefresh struct {
	Auto              bool `json:"auto"`
	Background        bool `json:"background"`
	MetricsIntervalMs int  `json:"metricsIntervalMs"`
}

// settingsKubeconfig captures user-configurable kubeconfig settings.
type settingsKubeconfig struct {
	Selected    []string `json:"selected"`
	Active      string   `json:"active"`
	SearchPaths []string `json:"searchPaths"`
}

// settingsUI captures user-configurable UI settings.
type settingsUI struct {
	Window    WindowSettings `json:"window"`
	LastView  *string        `json:"lastView"`
	ZoomLevel int            `json:"zoomLevel"`
}

// defaultSettingsFile provides a fully-populated settings file with safe defaults.
func defaultSettingsFile() *settingsFile {
	return &settingsFile{
		SchemaVersion: settingsSchemaVersion,
		UpdatedAt:     time.Now().UTC(),
		Preferences: settingsPreferences{
			Theme:                    "system",
			Refresh:                  &settingsRefresh{Auto: true, Background: true, MetricsIntervalMs: defaultMetricsIntervalMs()},
			GridTablePersistenceMode: "shared",
		},
		Kubeconfig: settingsKubeconfig{
			SearchPaths: defaultKubeconfigSearchPaths(),
		},
	}
}

// normalizeSettingsFile ensures required defaults are present after loading.
func normalizeSettingsFile(settings *settingsFile) *settingsFile {
	if settings == nil {
		return defaultSettingsFile()
	}
	if settings.SchemaVersion == 0 {
		settings.SchemaVersion = settingsSchemaVersion
	}
	if settings.Preferences.Theme == "" {
		settings.Preferences.Theme = "system"
	}
	if settings.Preferences.Refresh == nil {
		settings.Preferences.Refresh = &settingsRefresh{Auto: true, Background: true, MetricsIntervalMs: defaultMetricsIntervalMs()}
	}
	if settings.Preferences.Refresh.MetricsIntervalMs <= 0 {
		settings.Preferences.Refresh.MetricsIntervalMs = defaultMetricsIntervalMs()
	}
	if settings.Preferences.GridTablePersistenceMode == "" {
		settings.Preferences.GridTablePersistenceMode = "shared"
	}
	if settings.Kubeconfig.SearchPaths == nil {
		settings.Kubeconfig.SearchPaths = defaultKubeconfigSearchPaths()
	}
	return settings
}

func defaultMetricsIntervalMs() int {
	return int(config.RefreshMetricsInterval / time.Millisecond)
}

// defaultKubeconfigSearchPaths returns the default list of kubeconfig locations.
func defaultKubeconfigSearchPaths() []string {
	return []string{"~/.kube"}
}

// getSettingsFilePath returns the path to the new settings.json location.
func (a *App) getSettingsFilePath() (string, error) {
	configDir, err := os.UserConfigDir()
	if err != nil {
		return "", fmt.Errorf("could not find config directory: %w", err)
	}

	configDir = filepath.Join(configDir, "luxury-yacht")
	if err := os.MkdirAll(configDir, 0o755); err != nil {
		return "", fmt.Errorf("failed to create config directory: %w", err)
	}

	return filepath.Join(configDir, "settings.json"), nil
}

// loadSettingsFile reads settings.json or returns defaults when missing.
func (a *App) loadSettingsFile() (*settingsFile, error) {
	configFile, err := a.getSettingsFilePath()
	if err != nil {
		return nil, err
	}

	if _, err := os.Stat(configFile); os.IsNotExist(err) {
		return defaultSettingsFile(), nil
	}

	data, err := os.ReadFile(configFile)
	if err != nil {
		return nil, fmt.Errorf("failed to read settings file: %w", err)
	}

	settings := &settingsFile{}
	if err := json.Unmarshal(data, settings); err != nil {
		return nil, fmt.Errorf("failed to parse settings file: %w", err)
	}

	return normalizeSettingsFile(settings), nil
}

// saveSettingsFile writes settings.json with an updated timestamp.
func (a *App) saveSettingsFile(settings *settingsFile) error {
	if settings == nil {
		return fmt.Errorf("no settings to save")
	}

	configFile, err := a.getSettingsFilePath()
	if err != nil {
		return err
	}

	settings.SchemaVersion = settingsSchemaVersion
	settings.UpdatedAt = time.Now().UTC()

	data, err := json.Marshal(settings)
	if err != nil {
		return fmt.Errorf("failed to marshal settings: %w", err)
	}

	if err := writeFileAtomic(configFile, data, 0o644); err != nil {
		return fmt.Errorf("failed to write settings file: %w", err)
	}
	return nil
}

// writeFileAtomic persists data with a temp file + rename sequence.
func writeFileAtomic(path string, data []byte, perm os.FileMode) error {
	dir := filepath.Dir(path)
	tempFile, err := os.CreateTemp(dir, ".tmp-*")
	if err != nil {
		return err
	}
	defer os.Remove(tempFile.Name())

	if _, err := tempFile.Write(data); err != nil {
		tempFile.Close()
		return err
	}
	if err := tempFile.Sync(); err != nil {
		tempFile.Close()
		return err
	}
	if err := tempFile.Close(); err != nil {
		return err
	}
	if err := os.Chmod(tempFile.Name(), perm); err != nil {
		return err
	}

	// Windows cannot rename over an existing file, so remove it first.
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		return err
	}
	return os.Rename(tempFile.Name(), path)
}

func (a *App) SaveWindowSettings() error {
	x, y := runtimeWindowGetPosition(a.Ctx)
	width, height := runtimeWindowGetSize(a.Ctx)
	maximized := runtimeWindowIsMaximised(a.Ctx)

	a.windowSettings = &WindowSettings{X: x, Y: y, Width: width, Height: height, Maximized: maximized}

	settings, err := a.loadSettingsFile()
	if err != nil {
		return err
	}

	settings.UI.Window = *a.windowSettings
	return a.saveSettingsFile(settings)
}

func (a *App) LoadWindowSettings() (*WindowSettings, error) {
	settings, err := a.loadSettingsFile()
	if err != nil {
		return nil, err
	}

	window := settings.UI.Window
	if window.Width <= 0 || window.Height <= 0 {
		window.Width = 1200
		window.Height = 800
	}

	a.windowSettings = &window
	return &window, nil
}

func getDefaultAppSettings() *AppSettings {
	return &AppSettings{
		Theme:                            "system",
		SelectedKubeconfigs:              nil,
		UseShortResourceNames:            false,
		AutoRefreshEnabled:               true,
		RefreshBackgroundClustersEnabled: true,
		MetricsRefreshIntervalMs:         defaultMetricsIntervalMs(),
		GridTablePersistenceMode:         "shared",
	}
}

func (a *App) loadAppSettings() error {
	settings, err := a.loadSettingsFile()
	if err != nil {
		return err
	}

	a.appSettings = &AppSettings{
		Theme:                            settings.Preferences.Theme,
		SelectedKubeconfigs:              append([]string(nil), settings.Kubeconfig.Selected...),
		UseShortResourceNames:            settings.Preferences.UseShortResourceNames,
		AutoRefreshEnabled:               settings.Preferences.Refresh.Auto,
		RefreshBackgroundClustersEnabled: settings.Preferences.Refresh.Background,
		MetricsRefreshIntervalMs:         settings.Preferences.Refresh.MetricsIntervalMs,
		GridTablePersistenceMode:         settings.Preferences.GridTablePersistenceMode,
	}
	return nil
}

func (a *App) saveAppSettings() error {
	if a.appSettings == nil {
		return fmt.Errorf("no app settings to save")
	}

	settings, err := a.loadSettingsFile()
	if err != nil {
		return err
	}

	settings.Preferences.Theme = a.appSettings.Theme
	settings.Preferences.UseShortResourceNames = a.appSettings.UseShortResourceNames
	if settings.Preferences.Refresh == nil {
		settings.Preferences.Refresh = &settingsRefresh{}
	}
	settings.Preferences.Refresh.Auto = a.appSettings.AutoRefreshEnabled
	settings.Preferences.Refresh.Background = a.appSettings.RefreshBackgroundClustersEnabled
	settings.Preferences.Refresh.MetricsIntervalMs = a.appSettings.MetricsRefreshIntervalMs
	settings.Preferences.GridTablePersistenceMode = a.appSettings.GridTablePersistenceMode

	settings.Kubeconfig.Selected = append([]string(nil), a.appSettings.SelectedKubeconfigs...)

	return a.saveSettingsFile(settings)
}

// ClearAppState deletes persisted state files and resets in-memory caches for a clean restart.
func (a *App) ClearAppState() error {
	if err := a.clearKubeconfigSelection(); err != nil {
		return err
	}

	var errs []error

	settingsFile, err := a.getSettingsFilePath()
	if err == nil {
		if err := removeFileIfExists(settingsFile); err != nil {
			errs = append(errs, err)
		}
	} else {
		errs = append(errs, err)
	}

	persistenceFile, err := a.getPersistenceFilePath()
	if err == nil {
		if err := removeFileIfExists(persistenceFile); err != nil {
			errs = append(errs, err)
		}
	} else {
		errs = append(errs, err)
	}

	a.appSettings = nil
	a.windowSettings = nil

	if len(errs) > 0 {
		return fmt.Errorf("clear app state: %w", errs[0])
	}

	return nil
}

// removeFileIfExists ignores missing files so reset can be re-run safely.
func removeFileIfExists(path string) error {
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

func (a *App) GetAppSettings() (*AppSettings, error) {
	if a.appSettings != nil {
		return a.appSettings, nil
	}

	if err := a.loadAppSettings(); err != nil {
		return getDefaultAppSettings(), nil
	}

	return a.appSettings, nil
}

func (a *App) SetTheme(theme string) error {
	if theme != "light" && theme != "dark" && theme != "system" {
		return fmt.Errorf("invalid theme: %s", theme)
	}

	if a.appSettings == nil {
		if err := a.loadAppSettings(); err != nil {
			return err
		}
	}

	a.logger.Info(fmt.Sprintf("Theme changed to: %s", theme), "Settings")
	a.appSettings.Theme = theme
	return a.saveAppSettings()
}

func (a *App) SetUseShortResourceNames(useShort bool) error {
	if a.appSettings == nil {
		if err := a.loadAppSettings(); err != nil {
			return err
		}
	}

	a.logger.Info(fmt.Sprintf("Use short resource names changed to: %v", useShort), "Settings")
	a.appSettings.UseShortResourceNames = useShort
	return a.saveAppSettings()
}

// SetAutoRefreshEnabled persists the auto-refresh preference.
func (a *App) SetAutoRefreshEnabled(enabled bool) error {
	if a.appSettings == nil {
		if err := a.loadAppSettings(); err != nil {
			return err
		}
	}

	a.logger.Info(fmt.Sprintf("Auto refresh enabled changed to: %v", enabled), "Settings")
	a.appSettings.AutoRefreshEnabled = enabled
	return a.saveAppSettings()
}

// SetBackgroundRefreshEnabled persists the background refresh preference.
func (a *App) SetBackgroundRefreshEnabled(enabled bool) error {
	if a.appSettings == nil {
		if err := a.loadAppSettings(); err != nil {
			return err
		}
	}

	a.logger.Info(fmt.Sprintf("Background refresh enabled changed to: %v", enabled), "Settings")
	a.appSettings.RefreshBackgroundClustersEnabled = enabled
	return a.saveAppSettings()
}

// SetGridTablePersistenceMode persists the grid table persistence mode.
func (a *App) SetGridTablePersistenceMode(mode string) error {
	if mode != "shared" && mode != "namespaced" {
		return fmt.Errorf("invalid grid table persistence mode: %s", mode)
	}

	if a.appSettings == nil {
		if err := a.loadAppSettings(); err != nil {
			return err
		}
	}

	a.logger.Info(fmt.Sprintf("Grid table persistence mode changed to: %s", mode), "Settings")
	a.appSettings.GridTablePersistenceMode = mode
	return a.saveAppSettings()
}

func (a *App) GetThemeInfo() (*ThemeInfo, error) {
	settings, err := a.GetAppSettings()
	if err != nil {
		return nil, err
	}

	return &ThemeInfo{
		CurrentTheme: settings.Theme,
		UserTheme:    settings.Theme,
	}, nil
}

func (a *App) ShowSettings() {
	maxRetries := 3
	for i := 0; i < maxRetries; i++ {
		if a.Ctx != nil {
			a.logger.Debug("Settings menu triggered", "App")
			a.emitEvent("open-settings")
			return
		}
		if i < maxRetries-1 {
			time.Sleep(100 * time.Millisecond)
		}
	}
	a.logger.Warn("Cannot show settings: application context is nil after retries", "App")
}

func (a *App) ShowAbout() {
	maxRetries := 3
	for i := 0; i < maxRetries; i++ {
		if a.Ctx != nil {
			a.logger.Debug("About menu triggered", "App")
			a.emitEvent("open-about")
			return
		}
		if i < maxRetries-1 {
			time.Sleep(100 * time.Millisecond)
		}
	}
	a.logger.Warn("Cannot show about: application context is nil after retries", "App")
}

// GetZoomLevel returns the persisted zoom level (50-200), defaulting to 100.
func (a *App) GetZoomLevel() int {
	settings, err := a.loadSettingsFile()
	if err != nil {
		return 100
	}

	level := settings.UI.ZoomLevel
	if level < 50 || level > 200 {
		return 100
	}
	return level
}

// SetZoomLevel persists the zoom level (clamped to 50-200).
func (a *App) SetZoomLevel(level int) error {
	// Clamp to valid range
	if level < 50 {
		level = 50
	}
	if level > 200 {
		level = 200
	}

	settings, err := a.loadSettingsFile()
	if err != nil {
		return err
	}

	settings.UI.ZoomLevel = level
	return a.saveSettingsFile(settings)
}
