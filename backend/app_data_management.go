package backend

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"strings"
	"time"

	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

const (
	settingsDataFormat           = "luxury-yacht-settings"
	settingsDataSchemaVersion    = 1
	favoritesDataFormat          = "luxury-yacht-favorites"
	favoritesDataSchemaVersion   = 1
	maximumDataImportFileBytes   = 10 << 20
	settingsDataDefaultFilename  = "luxury-yacht-settings.json"
	favoritesDataDefaultFilename = "luxury-yacht-favorites.json"
)

type DataManagementResult struct {
	Path     string `json:"path"`
	Canceled bool   `json:"canceled"`
	Imported int    `json:"imported,omitempty"`
}

type settingsDataFile struct {
	Format                string              `json:"format"`
	SchemaVersion         int                 `json:"schemaVersion"`
	ExportedAt            time.Time           `json:"exportedAt"`
	Preferences           settingsPreferences `json:"preferences"`
	KubeconfigSearchPaths []string            `json:"kubeconfigSearchPaths"`
}

type favoritesDataFile struct {
	Format        string     `json:"format"`
	SchemaVersion int        `json:"schemaVersion"`
	ExportedAt    time.Time  `json:"exportedAt"`
	Favorites     []Favorite `json:"favorites"`
}

func (a *App) ExportSettings() (DataManagementResult, error) {
	if err := a.requireDataManagementContext(); err != nil {
		return DataManagementResult{}, err
	}

	a.settingsMu.Lock()
	settings, err := a.loadSettingsFile()
	if err == nil {
		settings = normalizeSettingsFile(settings)
	}
	a.settingsMu.Unlock()
	if err != nil {
		return DataManagementResult{}, fmt.Errorf("load settings for export: %w", err)
	}

	document := settingsDataFile{
		Format:                settingsDataFormat,
		SchemaVersion:         settingsDataSchemaVersion,
		ExportedAt:            time.Now().UTC(),
		Preferences:           settings.Preferences,
		KubeconfigSearchPaths: append([]string(nil), settings.Kubeconfig.SearchPaths...),
	}
	return a.exportDataFile("Export Settings", settingsDataDefaultFilename, document)
}

func (a *App) ImportSettings() (DataManagementResult, error) {
	if err := a.requireDataManagementContext(); err != nil {
		return DataManagementResult{}, err
	}
	path, canceled, err := a.chooseDataImportFile("Import Settings")
	if err != nil || canceled {
		return DataManagementResult{Canceled: canceled}, err
	}
	data, err := readDataImportFile(path)
	if err != nil {
		return DataManagementResult{}, fmt.Errorf("read settings import: %w", err)
	}
	document, effects, err := decodeSettingsDataFile(data)
	if err != nil {
		return DataManagementResult{}, err
	}
	if err := a.runSelectionMutation("import-settings", func(_ *selectionMutation) error {
		return a.applySettingsDataFile(document, effects)
	}); err != nil {
		return DataManagementResult{}, err
	}
	return DataManagementResult{Path: path, Imported: 1}, nil
}

func (a *App) ExportFavorites() (DataManagementResult, error) {
	if err := a.requireDataManagementContext(); err != nil {
		return DataManagementResult{}, err
	}
	favoritesMu.Lock()
	state, err := a.loadFavoritesFile()
	if err == nil {
		state.Favorites = cloneFavorites(state.Favorites)
	}
	favoritesMu.Unlock()
	if err != nil {
		return DataManagementResult{}, fmt.Errorf("load favorites for export: %w", err)
	}
	document := favoritesDataFile{
		Format:        favoritesDataFormat,
		SchemaVersion: favoritesDataSchemaVersion,
		ExportedAt:    time.Now().UTC(),
		Favorites:     state.Favorites,
	}
	return a.exportDataFile("Export Favorites", favoritesDataDefaultFilename, document)
}

func (a *App) ImportFavorites() (DataManagementResult, error) {
	if err := a.requireDataManagementContext(); err != nil {
		return DataManagementResult{}, err
	}
	path, canceled, err := a.chooseDataImportFile("Import Favorites")
	if err != nil || canceled {
		return DataManagementResult{Canceled: canceled}, err
	}
	data, err := readDataImportFile(path)
	if err != nil {
		return DataManagementResult{}, fmt.Errorf("read favorites import: %w", err)
	}
	document, err := decodeFavoritesDataFile(data)
	if err != nil {
		return DataManagementResult{}, err
	}

	favoritesMu.Lock()
	err = a.saveFavoritesFile(&favoritesFile{Favorites: document.Favorites})
	favoritesMu.Unlock()
	if err != nil {
		return DataManagementResult{}, fmt.Errorf("save imported favorites: %w", err)
	}
	return DataManagementResult{Path: path, Imported: len(document.Favorites)}, nil
}

func (a *App) requireDataManagementContext() error {
	if a == nil {
		return fmt.Errorf("app is not initialised")
	}
	if a.Ctx == nil {
		return fmt.Errorf("application context is not available")
	}
	return nil
}

func (a *App) exportDataFile(title, defaultFilename string, document any) (DataManagementResult, error) {
	path, err := runtimeSaveFileDialog(a.Ctx, wailsruntime.SaveDialogOptions{
		Title:            title,
		DefaultDirectory: dataManagementDefaultDirectory(),
		DefaultFilename:  defaultFilename,
		Filters: []wailsruntime.FileFilter{
			{DisplayName: "JSON files (*.json)", Pattern: "*.json"},
		},
		CanCreateDirectories: true,
	})
	if err != nil {
		return DataManagementResult{}, fmt.Errorf("select export file: %w", err)
	}
	path = strings.TrimSpace(path)
	if path == "" {
		return DataManagementResult{Canceled: true}, nil
	}

	data, err := json.MarshalIndent(document, "", "  ")
	if err != nil {
		return DataManagementResult{}, fmt.Errorf("encode export: %w", err)
	}
	data = append(data, '\n')
	if err := writeFileAtomic(path, data, 0o600); err != nil {
		return DataManagementResult{}, fmt.Errorf("write export: %w", err)
	}
	return DataManagementResult{Path: path}, nil
}

func (a *App) chooseDataImportFile(title string) (path string, canceled bool, err error) {
	path, err = runtimeOpenFileDialog(a.Ctx, wailsruntime.OpenDialogOptions{
		Title:            title,
		DefaultDirectory: dataManagementDefaultDirectory(),
		Filters: []wailsruntime.FileFilter{
			{DisplayName: "JSON files (*.json)", Pattern: "*.json"},
		},
	})
	if err != nil {
		return "", false, fmt.Errorf("select import file: %w", err)
	}
	path = strings.TrimSpace(path)
	return path, path == "", nil
}

func dataManagementDefaultDirectory() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return home
}

func readDataImportFile(path string) ([]byte, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, maximumDataImportFileBytes+1))
	if err != nil {
		return nil, err
	}
	if len(data) > maximumDataImportFileBytes {
		return nil, fmt.Errorf("import file exceeds %d bytes", maximumDataImportFileBytes)
	}
	return data, nil
}

func decodeSettingsDataFile(data []byte) (*settingsDataFile, settingsSideEffects, error) {
	var document settingsDataFile
	if err := json.Unmarshal(data, &document); err != nil {
		return nil, settingsSideEffects{}, fmt.Errorf("parse settings import: %w", err)
	}
	if document.Format != settingsDataFormat {
		return nil, settingsSideEffects{}, fmt.Errorf("selected file is not a Luxury Yacht settings export")
	}
	if document.SchemaVersion != settingsDataSchemaVersion {
		return nil, settingsSideEffects{}, fmt.Errorf("unsupported settings export schema version %d", document.SchemaVersion)
	}
	document.KubeconfigSearchPaths = normalizeKubeconfigSearchPaths(document.KubeconfigSearchPaths)
	if len(document.KubeconfigSearchPaths) == 0 {
		return nil, settingsSideEffects{}, fmt.Errorf("settings import must contain at least one kubeconfig search path")
	}

	normalized := normalizeSettingsFile(&settingsFile{
		SchemaVersion: settingsSchemaVersion,
		Preferences:   document.Preferences,
		Kubeconfig:    settingsKubeconfig{SearchPaths: document.KubeconfigSearchPaths},
	})
	document.Preferences = normalized.Preferences
	importedSettings := appSettingsFromFile(normalized)
	validated := getDefaultAppSettings()
	effects := settingsSideEffects{}
	for _, descriptor := range appPreferenceDescriptors() {
		if err := descriptor.apply(validated, descriptor.key, descriptor.current(importedSettings), &effects); err != nil {
			return nil, settingsSideEffects{}, fmt.Errorf("validate settings import: %w", err)
		}
	}
	if err := validateImportedThemes(document.Preferences.Themes); err != nil {
		return nil, settingsSideEffects{}, err
	}
	return &document, effects, nil
}

func validateImportedThemes(themes []Theme) error {
	seen := make(map[string]struct{}, len(themes))
	for _, theme := range themes {
		if strings.TrimSpace(theme.ID) == "" {
			return fmt.Errorf("validate settings import: theme ID is required")
		}
		if strings.TrimSpace(theme.Name) == "" {
			return fmt.Errorf("validate settings import: theme name is required")
		}
		if _, exists := seen[theme.ID]; exists {
			return fmt.Errorf("validate settings import: duplicate theme ID %q", theme.ID)
		}
		seen[theme.ID] = struct{}{}
		if theme.ID != defaultThemeID {
			if err := validateThemeClusterPattern(theme.ClusterPattern); err != nil {
				return fmt.Errorf("validate settings import: theme %q: %w", theme.Name, err)
			}
		}
	}
	return nil
}

func (a *App) applySettingsDataFile(document *settingsDataFile, effects settingsSideEffects) error {
	a.settingsMu.Lock()
	current, err := a.loadSettingsFile()
	if err != nil {
		a.settingsMu.Unlock()
		return fmt.Errorf("load current settings: %w", err)
	}
	previousAppSettings := copyAppSettings(a.appSettings)
	current.Preferences = document.Preferences
	current.Kubeconfig.SearchPaths = append([]string(nil), document.KubeconfigSearchPaths...)
	nextAppSettings := appSettingsFromFile(current)
	a.appSettings = nextAppSettings
	if err := a.saveSettingsFile(current); err != nil {
		a.appSettings = previousAppSettings
		a.settingsMu.Unlock()
		return fmt.Errorf("save imported settings: %w", err)
	}
	a.settingsMu.Unlock()

	a.applySettingsSideEffects(&preparedPreferenceUpdate{settings: nextAppSettings, effects: effects})
	a.refreshKubeconfigDiscoveryAfterSearchPathChange()
	return nil
}

func decodeFavoritesDataFile(data []byte) (*favoritesDataFile, error) {
	var document favoritesDataFile
	if err := json.Unmarshal(data, &document); err != nil {
		return nil, fmt.Errorf("parse favorites import: %w", err)
	}
	if document.Format != favoritesDataFormat {
		return nil, fmt.Errorf("selected file is not a Luxury Yacht favorites export")
	}
	if document.SchemaVersion != favoritesDataSchemaVersion {
		return nil, fmt.Errorf("unsupported favorites export schema version %d", document.SchemaVersion)
	}
	seen := make(map[string]struct{}, len(document.Favorites))
	for index := range document.Favorites {
		favorite := &document.Favorites[index]
		favorite.ID = strings.TrimSpace(favorite.ID)
		favorite.Name = strings.TrimSpace(favorite.Name)
		if favorite.ID == "" {
			return nil, fmt.Errorf("favorite at index %d is missing an ID", index)
		}
		if favorite.Name == "" {
			return nil, fmt.Errorf("favorite %q is missing a name", favorite.ID)
		}
		if _, exists := seen[favorite.ID]; exists {
			return nil, fmt.Errorf("duplicate favorite ID %q", favorite.ID)
		}
		seen[favorite.ID] = struct{}{}
		if err := validateFavoritePanes(favorite.Panes); err != nil {
			return nil, fmt.Errorf("favorite %q: %w", favorite.ID, err)
		}
		normalizeFavoritePanes(favorite.Panes)
		favorite.Order = index
	}
	return &document, nil
}

func cloneFavorites(favorites []Favorite) []Favorite {
	data, err := json.Marshal(favorites)
	if err != nil {
		return append([]Favorite(nil), favorites...)
	}
	var cloned []Favorite
	if err := json.Unmarshal(data, &cloned); err != nil {
		return append([]Favorite(nil), favorites...)
	}
	return cloned
}
