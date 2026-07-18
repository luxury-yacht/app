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
		Panes: map[string]FavoritePaneState{
			"main": {
				Filters: FavoriteFilters{
					Search:     "nginx",
					Kinds:      FavoriteFilterSelection{Mode: "some", Values: []string{"Pod"}},
					Namespaces: FavoriteFilterSelection{Mode: "some", Values: []string{""}},
					QueryFacets: map[string]FavoriteFilterSelection{
						"apiGroups":      {Mode: "some", Values: []string{"apps"}},
						"resourceScopes": {Mode: "some", Values: []string{"Namespace"}},
					},
				},
				TableState: FavoriteTableState{SortColumn: "name", SortDirection: "asc"},
			},
		},
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
	require.Equal(t, fav.Panes["main"].Filters.QueryFacets, favs[0].Panes["main"].Filters.QueryFacets)
	require.Equal(t, FavoriteFilterSelection{Mode: "some", Values: []string{""}}, favs[0].Panes["main"].Filters.Namespaces)

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

func TestAppFavoritesRoundTripNamedPanes(t *testing.T) {
	setTestConfigEnv(t)
	app := newTestAppWithDefaults(t)
	favorite := Favorite{
		Name:      "Workloads and pods",
		ViewType:  "namespace",
		View:      "workloads",
		Namespace: "default",
		Panes: map[string]FavoritePaneState{
			"workloads": {
				Filters:    FavoriteFilters{Kinds: FavoriteFilterSelection{Mode: "some", Values: []string{"Deployment"}}},
				TableState: FavoriteTableState{SortColumn: "name", SortDirection: "asc"},
			},
			"pods": {
				Filters: FavoriteFilters{QueryFacets: map[string]FavoriteFilterSelection{
					"owners": {Mode: "some", Values: []string{"apps/v1/Deployment/default/api"}},
				}},
				TableState: FavoriteTableState{SortColumn: "node", SortDirection: "desc"},
			},
		},
	}

	_, err := app.AddFavorite(favorite)
	require.NoError(t, err)
	loaded, err := app.GetFavorites()
	require.NoError(t, err)
	require.Len(t, loaded, 1)
	require.Equal(t, favorite.Panes["pods"].Filters.QueryFacets, loaded[0].Panes["pods"].Filters.QueryFacets)
	require.Equal(t, "node", loaded[0].Panes["pods"].TableState.SortColumn)
}

func TestAppAddFavoriteRequiresNamedPane(t *testing.T) {
	setTestConfigEnv(t)
	app := newTestAppWithDefaults(t)

	_, err := app.AddFavorite(Favorite{Name: "Missing state", ViewType: "cluster", View: "nodes"})

	require.EqualError(t, err, "favorite must contain at least one named pane")
}

func TestLoadFavoritesFileResetsPrePaneSchema(t *testing.T) {
	setTestConfigEnv(t)
	app := newTestAppWithDefaults(t)
	path, err := app.getFavoritesFilePath()
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(path, []byte(`{
		"schemaVersion": 2,
		"favorites": [{"id":"old","name":"Old","viewType":"cluster","view":"browse"}]
	}`), 0o644))

	state, err := app.loadFavoritesFile()
	require.NoError(t, err)
	require.Equal(t, favoritesSchemaVersion, state.SchemaVersion)
	require.Empty(t, state.Favorites)
}

func TestLoadFavoritesFileResetsLegacyFilterSelections(t *testing.T) {
	setTestConfigEnv(t)
	app := newTestAppWithDefaults(t)
	path, err := app.getFavoritesFilePath()
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(path, []byte(`{
		"schemaVersion": 1,
		"favorites": [{
			"id": "legacy",
			"name": "Legacy",
			"clusterSelection": "",
			"viewType": "cluster",
			"view": "browse",
			"namespace": "",
			"filters": {
				"search": "",
				"kinds": [],
				"namespaces": ["team-a"],
				"queryFacets": {"apiGroups": []},
				"caseSensitive": false,
				"includeMetadata": false
			},
			"tableState": null,
			"order": 0
		}]
	}`), 0o644))

	state, err := app.loadFavoritesFile()
	require.NoError(t, err)
	require.Equal(t, favoritesSchemaVersion, state.SchemaVersion)
	require.Empty(t, state.Favorites)
}

func TestAppFavoritesOrdering(t *testing.T) {
	setTestConfigEnv(t)
	app := newTestAppWithDefaults(t)

	pane := map[string]FavoritePaneState{"main": {}}
	a, _ := app.AddFavorite(Favorite{Name: "A", ViewType: "cluster", View: "nodes", Panes: pane})
	b, _ := app.AddFavorite(Favorite{Name: "B", ViewType: "cluster", View: "rbac", Panes: pane})
	c, _ := app.AddFavorite(Favorite{Name: "C", ViewType: "namespace", View: "pods", Namespace: "default", Panes: pane})

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
