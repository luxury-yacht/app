package backend

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
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

	// Migration: old single-value palette fields, read-only, omitted when zero.
	PaletteHue        int `json:"paletteHue,omitempty"`
	PaletteSaturation int `json:"paletteSaturation,omitempty"`
	PaletteBrightness int `json:"paletteBrightness,omitempty"`

	// Per-theme palette fields.
	PaletteHueLight        int    `json:"paletteHueLight"`
	PaletteSaturationLight int    `json:"paletteSaturationLight"`
	PaletteBrightnessLight int    `json:"paletteBrightnessLight"`
	PaletteHueDark         int    `json:"paletteHueDark"`
	PaletteSaturationDark  int    `json:"paletteSaturationDark"`
	PaletteBrightnessDark  int    `json:"paletteBrightnessDark"`
	AccentColorLight       string `json:"accentColorLight,omitempty"`
	AccentColorDark        string `json:"accentColorDark,omitempty"`

	// Saved theme library. Order matters: first match wins for cluster pattern matching.
	Themes []Theme `json:"themes,omitempty"`
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

	// Migrate old single-value palette fields to per-theme fields.
	prefs := &settings.Preferences
	if (prefs.PaletteHue != 0 || prefs.PaletteSaturation != 0 || prefs.PaletteBrightness != 0) &&
		prefs.PaletteHueLight == 0 && prefs.PaletteSaturationLight == 0 && prefs.PaletteBrightnessLight == 0 &&
		prefs.PaletteHueDark == 0 && prefs.PaletteSaturationDark == 0 && prefs.PaletteBrightnessDark == 0 {
		prefs.PaletteHueLight = prefs.PaletteHue
		prefs.PaletteSaturationLight = prefs.PaletteSaturation
		prefs.PaletteBrightnessLight = prefs.PaletteBrightness
		prefs.PaletteHueDark = prefs.PaletteHue
		prefs.PaletteSaturationDark = prefs.PaletteSaturation
		prefs.PaletteBrightnessDark = prefs.PaletteBrightness
		prefs.PaletteHue = 0
		prefs.PaletteSaturation = 0
		prefs.PaletteBrightness = 0
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
		PaletteHueLight:                  settings.Preferences.PaletteHueLight,
		PaletteSaturationLight:           settings.Preferences.PaletteSaturationLight,
		PaletteBrightnessLight:           settings.Preferences.PaletteBrightnessLight,
		PaletteHueDark:                   settings.Preferences.PaletteHueDark,
		PaletteSaturationDark:            settings.Preferences.PaletteSaturationDark,
		PaletteBrightnessDark:            settings.Preferences.PaletteBrightnessDark,
		AccentColorLight:                 settings.Preferences.AccentColorLight,
		AccentColorDark:                  settings.Preferences.AccentColorDark,
		Themes:                           settings.Preferences.Themes,
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
	// Write per-theme palette fields; leave old fields zeroed so omitempty drops them.
	settings.Preferences.PaletteHueLight = a.appSettings.PaletteHueLight
	settings.Preferences.PaletteSaturationLight = a.appSettings.PaletteSaturationLight
	settings.Preferences.PaletteBrightnessLight = a.appSettings.PaletteBrightnessLight
	settings.Preferences.PaletteHueDark = a.appSettings.PaletteHueDark
	settings.Preferences.PaletteSaturationDark = a.appSettings.PaletteSaturationDark
	settings.Preferences.PaletteBrightnessDark = a.appSettings.PaletteBrightnessDark
	settings.Preferences.AccentColorLight = a.appSettings.AccentColorLight
	settings.Preferences.AccentColorDark = a.appSettings.AccentColorDark
	settings.Preferences.Themes = a.appSettings.Themes

	settings.Kubeconfig.Selected = append([]string(nil), a.appSettings.SelectedKubeconfigs...)

	return a.saveSettingsFile(settings)
}

// ClearAppState deletes persisted state files and resets in-memory caches for a clean restart.
func (a *App) ClearAppState() error {
	return a.runSelectionMutation("clear-app-state", func(_ *selectionMutation) error {
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

		a.settingsMu.Lock()
		a.appSettings = nil
		a.settingsMu.Unlock()
		a.windowSettings = nil

		if len(errs) > 0 {
			return fmt.Errorf("clear app state: %w", errs[0])
		}

		return nil
	})
}

// removeFileIfExists ignores missing files so reset can be re-run safely.
func removeFileIfExists(path string) error {
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

func (a *App) GetAppSettings() (*AppSettings, error) {
	a.settingsMu.Lock()
	defer a.settingsMu.Unlock()

	if a.appSettings == nil {
		if err := a.loadAppSettings(); err != nil {
			return getDefaultAppSettings(), nil
		}
	}

	cp := *a.appSettings
	cp.SelectedKubeconfigs = append([]string(nil), a.appSettings.SelectedKubeconfigs...)
	cp.Themes = append([]Theme(nil), a.appSettings.Themes...)
	return &cp, nil
}

func (a *App) SetTheme(theme string) error {
	if theme != "light" && theme != "dark" && theme != "system" {
		return fmt.Errorf("invalid theme: %s", theme)
	}

	a.settingsMu.Lock()
	defer a.settingsMu.Unlock()

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
	a.settingsMu.Lock()
	defer a.settingsMu.Unlock()

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
	a.settingsMu.Lock()
	defer a.settingsMu.Unlock()

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
	a.settingsMu.Lock()
	defer a.settingsMu.Unlock()

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

	a.settingsMu.Lock()
	defer a.settingsMu.Unlock()

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

// SetPaletteTint persists the palette hue (0-360), saturation (0-100), and brightness (-50 to +50) preferences
// for the specified theme ("light" or "dark"). Values are clamped to their valid ranges.
func (a *App) SetPaletteTint(theme string, hue, saturation, brightness int) error {
	if theme != "light" && theme != "dark" {
		return fmt.Errorf("invalid palette theme: %s", theme)
	}

	// Clamp hue to 0-360
	if hue < 0 {
		hue = 0
	}
	if hue > 360 {
		hue = 360
	}
	// Clamp saturation to 0-100
	if saturation < 0 {
		saturation = 0
	}
	if saturation > 100 {
		saturation = 100
	}
	// Clamp brightness to -50 to +50
	if brightness < -50 {
		brightness = -50
	}
	if brightness > 50 {
		brightness = 50
	}

	a.settingsMu.Lock()
	defer a.settingsMu.Unlock()

	if a.appSettings == nil {
		if err := a.loadAppSettings(); err != nil {
			return err
		}
	}

	a.logger.Info(fmt.Sprintf("Palette tint (%s) changed to hue=%d saturation=%d brightness=%d", theme, hue, saturation, brightness), "Settings")

	if theme == "light" {
		a.appSettings.PaletteHueLight = hue
		a.appSettings.PaletteSaturationLight = saturation
		a.appSettings.PaletteBrightnessLight = brightness
	} else {
		a.appSettings.PaletteHueDark = hue
		a.appSettings.PaletteSaturationDark = saturation
		a.appSettings.PaletteBrightnessDark = brightness
	}

	return a.saveAppSettings()
}

// validHexColorRe matches a 7-character hex color string (#rrggbb).
var validHexColorRe = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

// SetAccentColor persists a custom accent color for the specified theme ("light" or "dark").
// The color must be a 7-char hex string (#rrggbb) or an empty string to reset to default.
func (a *App) SetAccentColor(theme string, color string) error {
	if theme != "light" && theme != "dark" {
		return fmt.Errorf("invalid accent color theme: %s", theme)
	}
	if color != "" && !validHexColorRe.MatchString(color) {
		return fmt.Errorf("invalid accent color format: %s (expected #rrggbb)", color)
	}

	a.settingsMu.Lock()
	defer a.settingsMu.Unlock()

	if a.appSettings == nil {
		if err := a.loadAppSettings(); err != nil {
			return err
		}
	}

	a.logger.Info(fmt.Sprintf("Accent color (%s) changed to: %s", theme, color), "Settings")

	if theme == "light" {
		a.appSettings.AccentColorLight = color
	} else {
		a.appSettings.AccentColorDark = color
	}

	return a.saveAppSettings()
}

// syncThemesCacheLocked updates the in-memory appSettings cache with the current
// themes list so that saveAppSettings (used by SetPaletteTint, SetAccentColor,
// etc.) does not overwrite disk-persisted themes with stale cached data.
func (a *App) syncThemesCacheLocked(themes []Theme) {
	if a.appSettings != nil {
		a.appSettings.Themes = append([]Theme(nil), themes...)
	}
}

// GetThemes returns the saved theme library.
func (a *App) GetThemes() ([]Theme, error) {
	settings, err := a.loadSettingsFile()
	if err != nil {
		return nil, fmt.Errorf("loading settings: %w", err)
	}
	if settings.Preferences.Themes == nil {
		return []Theme{}, nil
	}
	return settings.Preferences.Themes, nil
}

// SaveTheme creates or updates a theme in the library. If a theme with the
// same ID exists it is updated in place; otherwise the theme is appended.
func (a *App) SaveTheme(theme Theme) error {
	if theme.ID == "" {
		return fmt.Errorf("theme ID is required")
	}
	if theme.Name == "" {
		return fmt.Errorf("theme name is required")
	}

	a.settingsMu.Lock()
	defer a.settingsMu.Unlock()

	settings, err := a.loadSettingsFile()
	if err != nil {
		return fmt.Errorf("loading settings: %w", err)
	}

	found := false
	for i, t := range settings.Preferences.Themes {
		if t.ID == theme.ID {
			settings.Preferences.Themes[i] = theme
			found = true
			break
		}
	}
	if !found {
		settings.Preferences.Themes = append(settings.Preferences.Themes, theme)
	}

	if err := a.saveSettingsFile(settings); err != nil {
		return err
	}
	a.syncThemesCacheLocked(settings.Preferences.Themes)
	return nil
}

// DeleteTheme removes a theme from the library by ID.
func (a *App) DeleteTheme(id string) error {
	a.settingsMu.Lock()
	defer a.settingsMu.Unlock()

	settings, err := a.loadSettingsFile()
	if err != nil {
		return fmt.Errorf("loading settings: %w", err)
	}

	idx := -1
	for i, t := range settings.Preferences.Themes {
		if t.ID == id {
			idx = i
			break
		}
	}
	if idx == -1 {
		return fmt.Errorf("theme not found: %s", id)
	}

	settings.Preferences.Themes = append(
		settings.Preferences.Themes[:idx],
		settings.Preferences.Themes[idx+1:]...,
	)

	if err := a.saveSettingsFile(settings); err != nil {
		return err
	}
	a.syncThemesCacheLocked(settings.Preferences.Themes)
	return nil
}

// ReorderThemes sets the theme ordering. The ids slice must contain exactly the
// same IDs as the current theme list (first-match priority depends on order).
func (a *App) ReorderThemes(ids []string) error {
	a.settingsMu.Lock()
	defer a.settingsMu.Unlock()

	settings, err := a.loadSettingsFile()
	if err != nil {
		return fmt.Errorf("loading settings: %w", err)
	}

	if len(ids) != len(settings.Preferences.Themes) {
		return fmt.Errorf("id count mismatch: got %d, have %d themes", len(ids), len(settings.Preferences.Themes))
	}

	byID := make(map[string]Theme, len(settings.Preferences.Themes))
	for _, t := range settings.Preferences.Themes {
		byID[t.ID] = t
	}

	reordered := make([]Theme, 0, len(ids))
	for _, id := range ids {
		t, ok := byID[id]
		if !ok {
			return fmt.Errorf("unknown theme ID: %s", id)
		}
		reordered = append(reordered, t)
	}

	settings.Preferences.Themes = reordered
	if err := a.saveSettingsFile(settings); err != nil {
		return err
	}
	a.syncThemesCacheLocked(settings.Preferences.Themes)
	return nil
}

// ApplyTheme loads a saved theme by ID and copies its palette values into the
// active settings fields, then persists. The frontend re-reads settings to
// pick up the changes.
func (a *App) ApplyTheme(id string) error {
	a.settingsMu.Lock()
	defer a.settingsMu.Unlock()

	settings, err := a.loadSettingsFile()
	if err != nil {
		return fmt.Errorf("loading settings: %w", err)
	}

	var theme *Theme
	for i, t := range settings.Preferences.Themes {
		if t.ID == id {
			theme = &settings.Preferences.Themes[i]
			break
		}
	}
	if theme == nil {
		return fmt.Errorf("theme not found: %s", id)
	}

	// Copy theme values into active palette fields.
	settings.Preferences.PaletteHueLight = theme.PaletteHueLight
	settings.Preferences.PaletteSaturationLight = theme.PaletteSaturationLight
	settings.Preferences.PaletteBrightnessLight = theme.PaletteBrightnessLight
	settings.Preferences.PaletteHueDark = theme.PaletteHueDark
	settings.Preferences.PaletteSaturationDark = theme.PaletteSaturationDark
	settings.Preferences.PaletteBrightnessDark = theme.PaletteBrightnessDark
	settings.Preferences.AccentColorLight = theme.AccentColorLight
	settings.Preferences.AccentColorDark = theme.AccentColorDark

	if err := a.saveSettingsFile(settings); err != nil {
		return err
	}

	// Sync the in-memory cache so saveAppSettings doesn't overwrite with stale data.
	if a.appSettings != nil {
		a.appSettings.PaletteHueLight = theme.PaletteHueLight
		a.appSettings.PaletteSaturationLight = theme.PaletteSaturationLight
		a.appSettings.PaletteBrightnessLight = theme.PaletteBrightnessLight
		a.appSettings.PaletteHueDark = theme.PaletteHueDark
		a.appSettings.PaletteSaturationDark = theme.PaletteSaturationDark
		a.appSettings.PaletteBrightnessDark = theme.PaletteBrightnessDark
		a.appSettings.AccentColorLight = theme.AccentColorLight
		a.appSettings.AccentColorDark = theme.AccentColorDark
		a.appSettings.Themes = append([]Theme(nil), settings.Preferences.Themes...)
	}
	return nil
}

// MatchThemeForCluster returns the first saved theme whose ClusterPattern
// matches the given context name using filepath.Match glob rules (* and ?).
// Returns nil if no theme matches.
func (a *App) MatchThemeForCluster(contextName string) (*Theme, error) {
	settings, err := a.loadSettingsFile()
	if err != nil {
		return nil, fmt.Errorf("loading settings: %w", err)
	}

	for _, t := range settings.Preferences.Themes {
		if t.ClusterPattern == "" {
			continue
		}
		matched, err := filepath.Match(t.ClusterPattern, contextName)
		if err != nil {
			// Invalid pattern — skip rather than fail.
			continue
		}
		if matched {
			result := t // copy
			return &result, nil
		}
	}

	return nil, nil
}
