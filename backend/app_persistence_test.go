package backend

import (
	"encoding/json"
	"os"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestAppFavoritesRoundTrip(t *testing.T) {
	setTestConfigEnv(t)
	app := newTestAppWithDefaults(t)

	// Initially empty.
	favs, err := app.GetFavorites()
	require.NoError(t, err)
	require.Empty(t, favs)

	// Add a favorite.
	fav := Favorite{
		Name:             "prod / default / Pods",
		ClusterSelection: "/path/config:prod",
		ViewType:         "namespace",
		View:             "pods",
		Namespace:        "default",
		Filters:          &FavoriteFilters{Search: "nginx", Kinds: []string{"Pod"}},
		TableState:       &FavoriteTableState{SortColumn: "name", SortDirection: "asc"},
	}
	added, err := app.AddFavorite(fav)
	require.NoError(t, err)
	require.NotEmpty(t, added.ID)
	require.Equal(t, "prod / default / Pods", added.Name)
	require.Equal(t, 0, added.Order)

	// Get should return it.
	favs, err = app.GetFavorites()
	require.NoError(t, err)
	require.Len(t, favs, 1)
	require.Equal(t, added.ID, favs[0].ID)

	// Update the name.
	added.Name = "Renamed"
	require.NoError(t, app.UpdateFavorite(added))
	favs, err = app.GetFavorites()
	require.NoError(t, err)
	require.Equal(t, "Renamed", favs[0].Name)

	// Delete.
	require.NoError(t, app.DeleteFavorite(added.ID))
	favs, err = app.GetFavorites()
	require.NoError(t, err)
	require.Empty(t, favs)
}

func TestAppFavoritesOrdering(t *testing.T) {
	setTestConfigEnv(t)
	app := newTestAppWithDefaults(t)

	a, _ := app.AddFavorite(Favorite{Name: "A", ViewType: "cluster", View: "nodes"})
	b, _ := app.AddFavorite(Favorite{Name: "B", ViewType: "cluster", View: "rbac"})
	c, _ := app.AddFavorite(Favorite{Name: "C", ViewType: "namespace", View: "pods", Namespace: "default"})

	// Reorder: C, A, B
	require.NoError(t, app.SetFavoriteOrder([]string{c.ID, a.ID, b.ID}))

	favs, _ := app.GetFavorites()
	require.Equal(t, "C", favs[0].Name)
	require.Equal(t, 0, favs[0].Order)
	require.Equal(t, "A", favs[1].Name)
	require.Equal(t, 1, favs[1].Order)
	require.Equal(t, "B", favs[2].Name)
	require.Equal(t, 2, favs[2].Order)
}

func TestAppDeleteFavoriteNotFound(t *testing.T) {
	setTestConfigEnv(t)
	app := newTestAppWithDefaults(t)

	err := app.DeleteFavorite("nonexistent")
	require.Error(t, err)
}

func TestAppUpdateFavoriteNotFound(t *testing.T) {
	setTestConfigEnv(t)
	app := newTestAppWithDefaults(t)

	err := app.UpdateFavorite(Favorite{ID: "nonexistent", Name: "X"})
	require.Error(t, err)
}

func TestAppClusterTabOrderRoundTrip(t *testing.T) {
	setTestConfigEnv(t)
	app := newTestAppWithDefaults(t)

	err := app.SetClusterTabOrder([]string{" /path/config:prod ", "/path/config:prod", "  ", "/path/other:dev"})
	require.NoError(t, err)

	order, err := app.GetClusterTabOrder()
	require.NoError(t, err)
	require.Equal(t, []string{"/path/config:prod", "/path/other:dev"}, order)
}

func TestAppGridTablePersistenceCRUD(t *testing.T) {
	setTestConfigEnv(t)
	app := newTestAppWithDefaults(t)

	key := "gridtable:v1:abc123:cluster-nodes"
	payload := json.RawMessage(`{"version":1,"columnVisibility":{"name":false}}`)

	require.NoError(t, app.SetGridTablePersistence(key, payload))

	entries, err := app.GetGridTablePersistence()
	require.NoError(t, err)
	require.Contains(t, entries, key)
	require.JSONEq(t, string(payload), string(entries[key]))

	require.NoError(t, app.DeleteGridTablePersistence(key))
	entries, err = app.GetGridTablePersistence()
	require.NoError(t, err)
	require.NotContains(t, entries, key)

	require.NoError(t, app.SetGridTablePersistence(key, payload))
	require.NoError(t, app.SetGridTablePersistence(key+"-2", payload))

	require.NoError(t, app.DeleteGridTablePersistenceEntries([]string{key}))
	entries, err = app.GetGridTablePersistence()
	require.NoError(t, err)
	require.NotContains(t, entries, key)
	require.Contains(t, entries, key+"-2")

	removed, err := app.ClearGridTablePersistence()
	require.NoError(t, err)
	require.Equal(t, 1, removed)
	entries, err = app.GetGridTablePersistence()
	require.NoError(t, err)
	require.Len(t, entries, 0)
}

func TestLoadPersistenceFileNormalizesDefaults(t *testing.T) {
	// Ensure persistence file normalization restores required defaults.
	setTestConfigEnv(t)
	app := newTestAppWithDefaults(t)

	configPath, err := app.getPersistenceFilePath()
	require.NoError(t, err)

	require.NoError(t, os.WriteFile(configPath, []byte(`{"schemaVersion":0}`), 0o644))

	state, err := app.loadPersistenceFile()
	require.NoError(t, err)
	require.Equal(t, persistenceSchemaVersion, state.SchemaVersion)
	require.NotNil(t, state.Tables.GridTable)
	require.NotNil(t, state.Tables.GridTable[gridTablePersistenceVersionKey])
}

func TestSavePersistenceFileOverwritesExistingData(t *testing.T) {
	// Verify persistence writes overwrite existing file contents.
	setTestConfigEnv(t)
	app := newTestAppWithDefaults(t)

	state := defaultPersistenceFile()
	state.ClusterTabs.Order = []string{"alpha"}
	require.NoError(t, app.savePersistenceFile(state))

	state.ClusterTabs.Order = []string{"beta"}
	require.NoError(t, app.savePersistenceFile(state))

	loaded, err := app.loadPersistenceFile()
	require.NoError(t, err)
	require.Equal(t, []string{"beta"}, loaded.ClusterTabs.Order)
}
