// Tests for legacy settings migration behavior.
package backend

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestMigrateLegacyBackendFilesImportsAndDeletes(t *testing.T) {
	setTestConfigEnv(t)
	app := newTestAppWithDefaults(t)

	configDir, err := os.UserConfigDir()
	require.NoError(t, err)

	legacyDir := filepath.Join(configDir, "luxury-yacht")
	require.NoError(t, os.MkdirAll(legacyDir, 0o755))

	window := WindowSettings{X: 10, Y: 20, Width: 900, Height: 600, Maximized: true}
	windowBytes, err := json.Marshal(window)
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(filepath.Join(legacyDir, "window-settings.json"), windowBytes, 0o644))

	useShort := true
	autoRefresh := false
	backgroundRefresh := false
	prefs := legacyAppPreferences{
		Theme:                            "dark",
		SelectedKubeconfig:               "/tmp/config:dev",
		SelectedKubeconfigs:              []string{"/tmp/config:dev"},
		UseShortResourceNames:            &useShort,
		AutoRefreshEnabled:               &autoRefresh,
		RefreshBackgroundClustersEnabled: &backgroundRefresh,
		GridTablePersistenceMode:         "namespaced",
	}
	prefsBytes, err := json.Marshal(prefs)
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(filepath.Join(legacyDir, "app-preferences.json"), prefsBytes, 0o644))

	app.migrateLegacyBackendFiles()

	settings, err := app.loadSettingsFile()
	require.NoError(t, err)
	require.Equal(t, window, settings.UI.Window)
	require.Equal(t, "dark", settings.Preferences.Theme)
	require.True(t, settings.Preferences.UseShortResourceNames)
	require.False(t, settings.Preferences.Refresh.Auto)
	require.False(t, settings.Preferences.Refresh.Background)
	require.Equal(t, "namespaced", settings.Preferences.GridTablePersistenceMode)
	require.Equal(t, []string{"/tmp/config:dev"}, settings.Kubeconfig.Selected)
	require.Equal(t, "/tmp/config:dev", settings.Kubeconfig.Active)

	_, err = os.Stat(filepath.Join(legacyDir, "window-settings.json"))
	require.True(t, os.IsNotExist(err))
	_, err = os.Stat(filepath.Join(legacyDir, "app-preferences.json"))
	require.True(t, os.IsNotExist(err))
}

func TestMigrateLegacyLocalStorageAppliesPreferencesAndPersistence(t *testing.T) {
	setTestConfigEnv(t)
	app := newTestAppWithDefaults(t)
	app.availableKubeconfigs = []KubeconfigInfo{
		{Name: "config", Path: "/tmp/config", Context: "prod"},
		{Name: "secondary", Path: "/tmp/secondary", Context: "dev"},
	}

	theme := "dark"
	useShort := true
	autoRefresh := false
	backgroundRefresh := false
	mode := "namespaced"
	payload := legacyLocalStoragePayload{
		Theme:                            &theme,
		UseShortResourceNames:            &useShort,
		AutoRefreshEnabled:               &autoRefresh,
		RefreshBackgroundClustersEnabled: &backgroundRefresh,
		GridTablePersistenceMode:         &mode,
		ClusterTabsOrder:                 []string{"config:prod", "/tmp/secondary:dev"},
		GridTableEntries: map[string]json.RawMessage{
			"gridtable:v1:abc123:cluster-nodes": json.RawMessage(`{"version":1,"columnVisibility":{}}`),
		},
	}

	require.NoError(t, app.MigrateLegacyLocalStorage(payload))

	settings, err := app.loadSettingsFile()
	require.NoError(t, err)
	require.Equal(t, "dark", settings.Preferences.Theme)
	require.True(t, settings.Preferences.UseShortResourceNames)
	require.False(t, settings.Preferences.Refresh.Auto)
	require.False(t, settings.Preferences.Refresh.Background)
	require.Equal(t, "namespaced", settings.Preferences.GridTablePersistenceMode)

	persistence, err := app.loadPersistenceFile()
	require.NoError(t, err)
	require.Equal(t, []string{"/tmp/config:prod", "/tmp/secondary:dev"}, persistence.ClusterTabs.Order)

	entries := persistence.Tables.GridTable[gridTablePersistenceVersionKey]
	require.NotNil(t, entries)
	require.Contains(t, entries, "gridtable:v1:abc123:cluster-nodes")
}
