package backend

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
	"k8s.io/client-go/util/homedir"
)

var (
	runtimeWindowGetPosition = runtime.WindowGetPosition
	runtimeWindowGetSize     = runtime.WindowGetSize
	runtimeWindowIsMaximised = runtime.WindowIsMaximised
)

func (a *App) getConfigFilePath() (string, error) {
	home := homedir.HomeDir()
	if home == "" {
		return "", fmt.Errorf("could not find home directory")
	}

	configDir := filepath.Join(home, ".config", "luxury-yacht")
	if err := os.MkdirAll(configDir, 0o755); err != nil {
		return "", fmt.Errorf("failed to create config directory: %w", err)
	}

	return filepath.Join(configDir, "window-settings.json"), nil
}

func (a *App) SaveWindowSettings() error {
	x, y := runtimeWindowGetPosition(a.Ctx)
	width, height := runtimeWindowGetSize(a.Ctx)
	maximized := runtimeWindowIsMaximised(a.Ctx)

	a.windowSettings = &WindowSettings{X: x, Y: y, Width: width, Height: height, Maximized: maximized}

	configFile, err := a.getConfigFilePath()
	if err != nil {
		return err
	}

	data, err := json.Marshal(a.windowSettings)
	if err != nil {
		return fmt.Errorf("failed to marshal settings: %w", err)
	}

	if err := os.WriteFile(configFile, data, 0o644); err != nil {
		return fmt.Errorf("failed to write settings file: %w", err)
	}
	return nil
}

func (a *App) LoadWindowSettings() (*WindowSettings, error) {
	configFile, err := a.getConfigFilePath()
	if err != nil {
		return nil, err
	}

	if _, err := os.Stat(configFile); os.IsNotExist(err) {
		return &WindowSettings{Width: 1200, Height: 800}, nil
	}

	data, err := os.ReadFile(configFile)
	if err != nil {
		return nil, fmt.Errorf("failed to read settings file: %w", err)
	}

	settings := &WindowSettings{}
	if err := json.Unmarshal(data, settings); err != nil {
		return nil, fmt.Errorf("failed to parse settings file: %w", err)
	}

	a.windowSettings = settings
	return settings, nil
}

func getDefaultAppSettings() *AppSettings {
	return &AppSettings{
		Theme:                 "system",
		SelectedKubeconfig:    "",
		UseShortResourceNames: false,
	}
}

func (a *App) loadAppSettings() error {
	configFile, err := a.getAppSettingsFilePath()
	if err != nil {
		return err
	}

	if _, err := os.Stat(configFile); os.IsNotExist(err) {
		a.appSettings = getDefaultAppSettings()
		return nil
	}

	data, err := os.ReadFile(configFile)
	if err != nil {
		return fmt.Errorf("failed to read app settings file: %w", err)
	}

	settings := &AppSettings{}
	if err := json.Unmarshal(data, settings); err != nil {
		return fmt.Errorf("failed to parse app settings file: %w", err)
	}

	a.appSettings = settings
	return nil
}

func (a *App) saveAppSettings() error {
	if a.appSettings == nil {
		return fmt.Errorf("no app settings to save")
	}

	configFile, err := a.getAppSettingsFilePath()
	if err != nil {
		return err
	}

	data, err := json.Marshal(a.appSettings)
	if err != nil {
		return fmt.Errorf("failed to marshal app settings: %w", err)
	}

	if err := os.WriteFile(configFile, data, 0o644); err != nil {
		return fmt.Errorf("failed to write app settings file: %w", err)
	}
	return nil
}

func (a *App) getAppSettingsFilePath() (string, error) {
	home := homedir.HomeDir()
	if home == "" {
		return "", fmt.Errorf("could not find home directory")
	}

	configDir := filepath.Join(home, ".config", "luxury-yacht")
	if err := os.MkdirAll(configDir, 0o755); err != nil {
		return "", fmt.Errorf("failed to create config directory: %w", err)
	}

	return filepath.Join(configDir, "app-preferences.json"), nil
}

func (a *App) GetAppSettings() (*AppSettings, error) {
	if a.appSettings != nil {
		return a.appSettings, nil
	}

	if err := a.loadAppSettings(); err != nil {
		return &AppSettings{Theme: "system", SelectedKubeconfig: ""}, nil
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
