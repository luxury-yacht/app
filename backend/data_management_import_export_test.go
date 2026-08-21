package backend

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/luxury-yacht/app/backend/internal/appupdates"
	"github.com/stretchr/testify/require"
	"github.com/wailsapp/wails/v3/pkg/application"
)

func dataManagementFavorite(id, name string) Favorite {
	return Favorite{
		ID:        id,
		Name:      name,
		ViewType:  "global",
		View:      "attention",
		Namespace: "",
		Panes: map[string]FavoritePaneState{
			"main": defaultFavoritePaneState(),
		},
	}
}

func installDataManagementDialogs(t *testing.T, app *settingsEffectsTestFixture, savePath, openPath string) (*application.SaveFileDialogOptions, *application.OpenFileDialogOptions) {
	t.Helper()
	saveOptions := &application.SaveFileDialogOptions{}
	openOptions := &application.OpenFileDialogOptions{}
	app.DesktopShell.saveFileDialog = func(options *application.SaveFileDialogOptions) (string, error) {
		*saveOptions = *options
		return savePath, nil
	}
	app.DesktopShell.openFileDialog = func(options *application.OpenFileDialogOptions) (string, error) {
		*openOptions = *options
		return openPath, nil
	}
	return saveOptions, openOptions
}

func TestDataManagementDialogsDefaultToUserHomeDirectory(t *testing.T) {
	setTestConfigEnv(t)
	app := newSettingsEffectsTestFixture(t)
	setTestAppRuntimeReady(t, app.Lifecycle, context.Background())
	home, err := os.UserHomeDir()
	require.NoError(t, err)
	require.NotEmpty(t, home)

	exportPath := filepath.Join(t.TempDir(), "export.json")
	saveOptions, openOptions := installDataManagementDialogs(t, app, exportPath, "")

	_, err = app.DataManagement.exportDataFile("Export Data", "export.json", map[string]string{"data": "value"})
	require.NoError(t, err)
	_, _, err = app.DataManagement.chooseDataImportFile("Import Data")
	require.NoError(t, err)

	require.Equal(t, home, saveOptions.Directory)
	require.Equal(t, home, openOptions.Directory)
}

func TestExportSettingsExportsPreferencesAndSearchPathsOnly(t *testing.T) {
	setTestConfigEnv(t)
	app := newSettingsEffectsTestFixture(t)
	setTestAppRuntimeReady(t, app.Lifecycle, context.Background())

	settings := defaultSettingsFile()
	settings.Preferences.AppearanceMode = "dark"
	settings.Preferences.UseShortResourceNames = true
	settings.Kubeconfig.SearchPaths = []string{"/portable/kubeconfigs"}
	settings.Kubeconfig.Selected = []string{"/session/config:context"}
	settings.Kubeconfig.Active = "/session/config:context"
	settings.UI.ZoomLevel = 125
	settings.Clusters = map[string]settingsClusterSection{
		"cluster-a": {AllowedNamespaces: []string{"team-a"}},
	}
	require.NoError(t, app.Preferences.saveSettingsFile(settings))

	exportPath := filepath.Join(t.TempDir(), "settings-export.json")
	installDataManagementDialogs(t, app, exportPath, "")

	result, err := app.DataManagement.ExportSettings()
	require.NoError(t, err)
	require.False(t, result.Canceled)
	require.Equal(t, exportPath, result.Path)

	data, err := os.ReadFile(exportPath)
	require.NoError(t, err)
	var exported settingsDataFile
	require.NoError(t, json.Unmarshal(data, &exported))
	require.Equal(t, settingsDataFormat, exported.Format)
	require.Equal(t, settingsDataSchemaVersion, exported.SchemaVersion)
	require.Equal(t, "dark", exported.Preferences.AppearanceMode)
	require.True(t, exported.Preferences.UseShortResourceNames)
	require.Equal(t, []string{"/portable/kubeconfigs"}, exported.KubeconfigSearchPaths)

	var document map[string]json.RawMessage
	require.NoError(t, json.Unmarshal(data, &document))
	require.NotContains(t, document, "ui")
	require.NotContains(t, document, "clusters")
	require.NotContains(t, document, "attention")
	require.NotContains(t, document, "selectedKubeconfigs")
	require.NotContains(t, document, "persistence")
	require.NotContains(t, document, "telemetry")
	require.NotContains(t, string(data), "anonymizedId")
}

func TestImportSettingsReplacesPortableSettingsAndPreservesSessionState(t *testing.T) {
	setTestConfigEnv(t)
	app := newSettingsEffectsTestFixture(t)
	setTestAppRuntimeReady(t, app.Lifecycle, context.Background())

	current := defaultSettingsFile()
	current.Preferences.AppearanceMode = "dark"
	current.Kubeconfig.SearchPaths = []string{"/old/search"}
	current.Kubeconfig.Selected = []string{"/session/config:context"}
	current.Kubeconfig.Active = "/session/config:context"
	current.UI.ZoomLevel = 125
	current.Clusters = map[string]settingsClusterSection{
		"cluster-a": {AllowedNamespaces: []string{"team-a"}},
	}
	current.Attention = &settingsGlobalAttentionRules{FindingTypes: []string{"pod-restarts"}}
	require.NoError(t, app.Preferences.saveSettingsFile(current))
	ensurePreferencesLoaded(t, app.Preferences)

	persistencePath, err := app.UIState.getPersistenceFilePath()
	require.NoError(t, err)
	persistenceBefore := []byte(`{"schemaVersion":1,"updatedAt":"2026-01-01T00:00:00Z","clusterTabs":{"order":["cluster-a"]},"tables":{"gridtable":{"v1":{"pods":{"sort":"name"}}}}}`)
	require.NoError(t, os.WriteFile(persistencePath, persistenceBefore, 0o644))

	importDir := t.TempDir()
	imported := settingsDataFile{
		Format:        settingsDataFormat,
		SchemaVersion: settingsDataSchemaVersion,
		Preferences: settingsPreferences{
			AppearanceMode:           "light",
			UseShortResourceNames:    true,
			DimInactiveNamespaces:    boolPtr(false),
			ExclusiveNamespaces:      boolPtr(false),
			Refresh:                  &settingsRefresh{Auto: false, Background: false, MetricsIntervalMs: 9000},
			GridTablePersistenceMode: "namespaced",
			DefaultTablePageSize:     100,
		},
		KubeconfigSearchPaths: []string{importDir},
	}
	importData, err := json.Marshal(imported)
	require.NoError(t, err)
	importPath := filepath.Join(t.TempDir(), "settings-import.json")
	require.NoError(t, os.WriteFile(importPath, importData, 0o600))
	installDataManagementDialogs(t, app, "", importPath)

	result, err := app.DataManagement.ImportSettings()
	require.NoError(t, err)
	require.False(t, result.Canceled)
	require.Equal(t, importPath, result.Path)

	saved, err := app.Preferences.loadSettingsFile()
	require.NoError(t, err)
	require.Equal(t, "light", saved.Preferences.AppearanceMode)
	require.True(t, saved.Preferences.UseShortResourceNames)
	require.False(t, *saved.Preferences.DimInactiveNamespaces)
	require.False(t, *saved.Preferences.ExclusiveNamespaces)
	require.False(t, saved.Preferences.Refresh.Auto)
	require.Equal(t, "namespaced", saved.Preferences.GridTablePersistenceMode)
	require.Equal(t, 100, saved.Preferences.DefaultTablePageSize)
	require.Equal(t, []string{importDir}, saved.Kubeconfig.SearchPaths)

	require.Equal(t, current.Kubeconfig.Selected, saved.Kubeconfig.Selected)
	require.Equal(t, current.Kubeconfig.Active, saved.Kubeconfig.Active)
	require.Equal(t, current.UI, saved.UI)
	require.Equal(t, current.Clusters, saved.Clusters)
	require.Equal(t, current.Attention, saved.Attention)
	require.Equal(t, current.Telemetry, saved.Telemetry)

	inMemory, err := app.Preferences.GetAppSettings()
	require.NoError(t, err)
	require.Equal(t, "light", inMemory.AppearanceMode)
	require.True(t, inMemory.UseShortResourceNames)
	require.Equal(t, current.Kubeconfig.Selected, inMemory.SelectedKubeconfigs)

	persistenceAfter, err := os.ReadFile(persistencePath)
	require.NoError(t, err)
	require.Equal(t, persistenceBefore, persistenceAfter)
}

func TestImportSettingsRejectsWrongFormatWithoutChangingSettings(t *testing.T) {
	setTestConfigEnv(t)
	app := newSettingsEffectsTestFixture(t)
	setTestAppRuntimeReady(t, app.Lifecycle, context.Background())
	current := defaultSettingsFile()
	current.Preferences.AppearanceMode = "dark"
	require.NoError(t, app.Preferences.saveSettingsFile(current))
	settingsPath, err := app.Preferences.getSettingsFilePath()
	require.NoError(t, err)
	before, err := os.ReadFile(settingsPath)
	require.NoError(t, err)

	importPath := filepath.Join(t.TempDir(), "favorites.json")
	require.NoError(t, os.WriteFile(importPath, []byte(`{"format":"luxury-yacht-favorites","schemaVersion":1,"favorites":[]}`), 0o600))
	installDataManagementDialogs(t, app, "", importPath)

	_, err = app.DataManagement.ImportSettings()
	require.ErrorContains(t, err, "not a Luxury Yacht settings export")
	after, readErr := os.ReadFile(settingsPath)
	require.NoError(t, readErr)
	require.Equal(t, before, after)
}

func TestFavoritesExportImportRoundTripReplacesLibrary(t *testing.T) {
	setTestConfigEnv(t)
	app := newSettingsEffectsTestFixture(t)
	setTestAppRuntimeReady(t, app.Lifecycle, context.Background())

	original := &favoritesFile{
		Favorites: []Favorite{
			dataManagementFavorite("favorite-a", "Favorite A"),
			dataManagementFavorite("favorite-b", "Favorite B"),
		},
	}
	require.NoError(t, app.Favorites.saveFavoritesFile(original))

	exportPath := filepath.Join(t.TempDir(), "favorites-export.json")
	installDataManagementDialogs(t, app, exportPath, exportPath)
	exportResult, err := app.DataManagement.ExportFavorites()
	require.NoError(t, err)
	require.False(t, exportResult.Canceled)

	exportData, err := os.ReadFile(exportPath)
	require.NoError(t, err)
	var exported favoritesDataFile
	require.NoError(t, json.Unmarshal(exportData, &exported))
	require.Equal(t, favoritesDataFormat, exported.Format)
	require.Equal(t, []string{"favorite-a", "favorite-b"}, []string{exported.Favorites[0].ID, exported.Favorites[1].ID})

	require.NoError(t, app.Favorites.saveFavoritesFile(&favoritesFile{
		Favorites: []Favorite{dataManagementFavorite("replace-me", "Replace Me")},
	}))

	importResult, err := app.DataManagement.ImportFavorites()
	require.NoError(t, err)
	require.False(t, importResult.Canceled)
	require.Equal(t, 2, importResult.Imported)

	got, err := app.Favorites.GetFavorites()
	require.NoError(t, err)
	require.Equal(t, []string{"favorite-a", "favorite-b"}, []string{got[0].ID, got[1].ID})
	require.Equal(t, []int{0, 1}, []int{got[0].Order, got[1].Order})
}

func TestImportFavoritesRejectsDuplicateIDsWithoutChangingLibrary(t *testing.T) {
	setTestConfigEnv(t)
	app := newSettingsEffectsTestFixture(t)
	setTestAppRuntimeReady(t, app.Lifecycle, context.Background())
	beforeFavorite := dataManagementFavorite("existing", "Existing")
	require.NoError(t, app.Favorites.saveFavoritesFile(&favoritesFile{Favorites: []Favorite{beforeFavorite}}))

	duplicate := dataManagementFavorite("duplicate", "First")
	data, err := json.Marshal(favoritesDataFile{
		Format:        favoritesDataFormat,
		SchemaVersion: favoritesDataSchemaVersion,
		Favorites: []Favorite{
			duplicate,
			dataManagementFavorite("duplicate", "Second"),
		},
	})
	require.NoError(t, err)
	importPath := filepath.Join(t.TempDir(), "favorites-import.json")
	require.NoError(t, os.WriteFile(importPath, data, 0o600))
	installDataManagementDialogs(t, app, "", importPath)

	_, err = app.DataManagement.ImportFavorites()
	require.ErrorContains(t, err, `duplicate favorite ID "duplicate"`)
	got, readErr := app.Favorites.GetFavorites()
	require.NoError(t, readErr)
	require.Equal(t, []Favorite{beforeFavorite}, got)
}

func TestDataManagementDialogsTreatCancelAsSuccess(t *testing.T) {
	setTestConfigEnv(t)
	app := newSettingsEffectsTestFixture(t)
	setTestAppRuntimeReady(t, app.Lifecycle, context.Background())
	installDataManagementDialogs(t, app, "", "")

	for _, action := range []func() (DataManagementResult, error){
		app.DataManagement.ExportSettings,
		app.DataManagement.ImportSettings,
		app.DataManagement.ExportFavorites,
		app.DataManagement.ImportFavorites,
	} {
		result, err := action()
		require.NoError(t, err)
		require.True(t, result.Canceled)
		require.Empty(t, result.Path)
	}
}

func TestDataManagementRequiresAnInitializedAppContext(t *testing.T) {
	var nilCoordinator *DataManagementCoordinator
	_, err := nilCoordinator.ExportSettings()
	require.ErrorContains(t, err, "not initialised")

	app := newSettingsEffectsTestFixture(t)
	_, err = app.DataManagement.ExportSettings()
	require.ErrorContains(t, err, "application context is not available")
}

func TestFactoryResetClearsEveryAppOwnedArtifactAndRestoresRuntimePolicyDefaults(t *testing.T) {
	setTestConfigEnv(t)
	app := newSettingsEffectsTestFixture(t)
	setTestAppRuntimeReady(t, app.Lifecycle, context.Background())
	updateState := &fakeApplicationUpdateCoordinator{}
	app.Updates.coordinator = updateState

	require.NoError(t, app.Preferences.saveSettingsFile(defaultSettingsFile()))
	require.NoError(t, app.Favorites.saveFavoritesFile(&favoritesFile{
		Favorites: []Favorite{dataManagementFavorite("favorite", "Favorite")},
	}))
	require.NoError(t, app.UIState.SetClusterTabOrder([]string{"cluster-a"}))
	settingsPath, err := app.Preferences.getSettingsFilePath()
	require.NoError(t, err)
	legacyStatePath := filepath.Join(filepath.Dir(settingsPath), "legacy", "state.json")
	require.NoError(t, os.MkdirAll(filepath.Dir(legacyStatePath), 0o700))
	require.NoError(t, os.WriteFile(legacyStatePath, []byte("{}"), 0o600))
	staleWritePath := filepath.Join(filepath.Dir(settingsPath), ".tmp-8675309")
	require.NoError(t, os.WriteFile(staleWritePath, []byte("stale"), 0o600))
	siblingStatePath := filepath.Join(filepath.Dir(filepath.Dir(settingsPath)), "another-app", "state.json")
	require.NoError(t, os.MkdirAll(filepath.Dir(siblingStatePath), 0o700))
	require.NoError(t, os.WriteFile(siblingStatePath, []byte("{}"), 0o600))
	externalKubeconfigPath := filepath.Join(t.TempDir(), "external-kubeconfig")
	require.NoError(t, os.WriteFile(externalKubeconfigPath, []byte("external"), 0o600))
	cachePath, err := app.Preferences.cacheDirPath()
	require.NoError(t, err)
	require.NoError(t, os.MkdirAll(cachePath, 0o700))
	require.NoError(t, os.WriteFile(filepath.Join(cachePath, "cached"), []byte("x"), 0o600))
	app.PermissionFetchPolicy.SetPermissionFetchConcurrency(1)
	app.ContainerLogsPolicy.SetContainerLogsPerScopeLimit(1)
	searchPathResets := 0
	app.DataManagement.searchPathsChanged = func() { searchPathResets++ }

	require.NoError(t, app.DataManagement.ClearAppState())
	require.NoError(t, app.DataManagement.ClearAppState(), "Factory Reset must be repeatable")

	favoritesPath, err := app.Favorites.getFavoritesFilePath()
	require.NoError(t, err)
	uiStatePath, err := app.UIState.getPersistenceFilePath()
	require.NoError(t, err)
	for _, path := range []string{settingsPath, favoritesPath, uiStatePath, staleWritePath, filepath.Dir(settingsPath), cachePath} {
		_, statErr := os.Lstat(path)
		require.ErrorIs(t, statErr, os.ErrNotExist, path)
	}
	require.FileExists(t, externalKubeconfigPath, "Factory Reset must preserve user-owned kubeconfig files")
	require.FileExists(t, siblingStatePath, "Factory Reset must preserve other applications' state")
	require.Nil(t, app.Preferences.appSettings)
	require.Equal(t, defaultPermissionSSRRFetchConcurrency, app.PermissionFetchPolicy.Concurrency())
	require.Equal(t, defaultObjPanelLogsTargetPerScopeLimit, app.ContainerLogsPolicy.Limit())
	require.Equal(t, 2, updateState.resetCalls)
	require.Equal(t, 2, searchPathResets)
}

func TestFactoryResetAttemptsIndependentOwnersAndReturnsPartialFailure(t *testing.T) {
	setTestConfigEnv(t)
	app := newSettingsEffectsTestFixture(t)
	setTestAppRuntimeReady(t, app.Lifecycle, context.Background())
	app.Updates.coordinator = &fakeApplicationUpdateCoordinator{resetErr: errors.New("updater busy")}
	require.NoError(t, app.Favorites.saveFavoritesFile(&favoritesFile{
		Favorites: []Favorite{dataManagementFavorite("favorite", "Favorite")},
	}))
	favoritesPath, err := app.Favorites.getFavoritesFilePath()
	require.NoError(t, err)
	recoveryPath := filepath.Join(filepath.Dir(favoritesPath), "update-recovery.json")
	require.NoError(t, os.WriteFile(recoveryPath, []byte("recovery"), 0o600))

	err = app.DataManagement.ClearAppState()

	require.ErrorContains(t, err, "updater busy")
	_, statErr := os.Lstat(favoritesPath)
	require.ErrorIs(t, statErr, os.ErrNotExist, "favorites reset must still run after updater failure")
	require.FileExists(t, recoveryPath, "the root sweep must not discard recovery data after an owner failure")
}

func TestFactoryResetSucceedsWhenUpdaterTempSetupFailed(t *testing.T) {
	setTestConfigEnv(t)
	app := newSettingsEffectsTestFixture(t)
	setTestAppRuntimeReady(t, app.Lifecycle, context.Background())
	foreignRoot := t.TempDir()
	foreignSentinel := filepath.Join(foreignRoot, "keep")
	require.NoError(t, os.WriteFile(foreignSentinel, []byte("foreign"), 0o600))
	updates := NewUpdateCoordinator(
		app.DesktopShell,
		app.signals.CtxOrBackground,
		app.signals.emitEvent,
		app.AppLogs.Logger(),
		ApplicationUpdateOptions{
			TempRoot:       foreignRoot,
			TempSetupError: errors.New("updater temp path is not owned by the current user"),
		},
	)
	app.Updates = updates
	app.DataManagement.updates = updates

	err := app.DataManagement.ClearAppState()

	require.NoError(t, err)
	require.Equal(t, appupdates.StatusDisabled, updates.coordinator.Snapshot().Status)
	require.FileExists(t, foreignSentinel)
}

func TestReadDataImportFileRejectsOversizedFiles(t *testing.T) {
	path := filepath.Join(t.TempDir(), "oversized.json")
	require.NoError(t, os.WriteFile(path, make([]byte, maximumDataImportFileBytes+1), 0o600))

	_, err := readDataImportFile(path)
	require.ErrorContains(t, err, "import file exceeds")
}

func TestDecodeSettingsDataFileRejectsInvalidPortableSettings(t *testing.T) {
	makeDocument := func() settingsDataFile {
		return settingsDataFile{
			Format:                settingsDataFormat,
			SchemaVersion:         settingsDataSchemaVersion,
			Preferences:           defaultSettingsFile().Preferences,
			KubeconfigSearchPaths: []string{"/portable/kubeconfigs"},
		}
	}

	t.Run("schema version", func(t *testing.T) {
		document := makeDocument()
		document.SchemaVersion++
		data, err := json.Marshal(document)
		require.NoError(t, err)
		_, _, err = decodeSettingsDataFile(data)
		require.ErrorContains(t, err, "unsupported settings export schema version")
	})

	t.Run("search paths", func(t *testing.T) {
		document := makeDocument()
		document.KubeconfigSearchPaths = []string{" "}
		data, err := json.Marshal(document)
		require.NoError(t, err)
		_, _, err = decodeSettingsDataFile(data)
		require.ErrorContains(t, err, "at least one kubeconfig search path")
	})

	t.Run("preference", func(t *testing.T) {
		document := makeDocument()
		document.Preferences.AppearanceMode = "sepia"
		data, err := json.Marshal(document)
		require.NoError(t, err)
		_, _, err = decodeSettingsDataFile(data)
		require.ErrorContains(t, err, "invalid appearance mode")
	})

	t.Run("theme", func(t *testing.T) {
		document := makeDocument()
		document.Preferences.Themes = append(document.Preferences.Themes, Theme{
			ID:   "custom",
			Name: " ",
		})
		data, err := json.Marshal(document)
		require.NoError(t, err)
		_, _, err = decodeSettingsDataFile(data)
		require.ErrorContains(t, err, "theme name is required")
	})
}

func TestDecodeSettingsImportRequestsAllSixRuntimeEffectRoutes(t *testing.T) {
	document := settingsDataFile{
		Format:                settingsDataFormat,
		SchemaVersion:         settingsDataSchemaVersion,
		Preferences:           defaultSettingsFile().Preferences,
		KubeconfigSearchPaths: []string{"/portable/kubeconfigs"},
	}
	data, err := json.Marshal(document)
	require.NoError(t, err)

	_, effects, err := decodeSettingsDataFile(data)
	require.NoError(t, err)
	require.Equal(t, allSettingsSideEffects(), effects)
}

func TestDecodeFavoritesDataFileRejectsInvalidFavorites(t *testing.T) {
	tests := []struct {
		name     string
		document favoritesDataFile
		message  string
	}{
		{
			name: "schema version",
			document: favoritesDataFile{
				Format:        favoritesDataFormat,
				SchemaVersion: favoritesDataSchemaVersion + 1,
			},
			message: "unsupported favorites export schema version",
		},
		{
			name: "missing ID",
			document: favoritesDataFile{
				Format:        favoritesDataFormat,
				SchemaVersion: favoritesDataSchemaVersion,
				Favorites:     []Favorite{dataManagementFavorite(" ", "Favorite")},
			},
			message: "missing an ID",
		},
		{
			name: "missing name",
			document: favoritesDataFile{
				Format:        favoritesDataFormat,
				SchemaVersion: favoritesDataSchemaVersion,
				Favorites:     []Favorite{dataManagementFavorite("favorite", " ")},
			},
			message: "missing a name",
		},
		{
			name: "missing panes",
			document: favoritesDataFile{
				Format:        favoritesDataFormat,
				SchemaVersion: favoritesDataSchemaVersion,
				Favorites: []Favorite{{
					ID:   "favorite",
					Name: "Favorite",
				}},
			},
			message: "at least one named pane",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			data, err := json.Marshal(test.document)
			require.NoError(t, err)
			_, err = decodeFavoritesDataFile(data)
			require.ErrorContains(t, err, test.message)
		})
	}
}
