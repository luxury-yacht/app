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

func TestLoadFavoritesFileMigratesV2FavoritesIndividually(t *testing.T) {
	setTestConfigEnv(t)
	app := newTestAppWithDefaults(t)
	path, err := app.getFavoritesFilePath()
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(path, []byte(`{
		"schemaVersion": 2,
		"favorites": [
			{
				"id": "first",
				"name": "First",
				"clusterSelection": "/clusters/alpha",
				"clusterId": "alpha:context",
				"clusterName": "alpha",
				"viewType": "cluster",
				"view": "browse",
				"namespace": "",
				"filters": {
					"search": "deploy",
					"kinds": {"mode":"some","values":["Deployment"]},
					"namespaces": {"mode":"all"},
					"clusters": {"mode":"some","values":["alpha:context"]},
					"queryFacets": {"apiGroups":{"mode":"some","values":["apps"]}},
					"caseSensitive": true,
					"includeMetadata": true
				},
				"tableState": {
					"sortColumn": "kind",
					"sortDirection": "desc",
					"columnVisibility": {"namespace":false}
				},
				"order": 0
			},
			{
				"id": "broken",
				"name": "Broken",
				"viewType": "cluster",
				"view": "nodes",
				"filters": "not-an-object",
				"tableState": {"sortColumn":"name","sortDirection":"asc"},
				"order": 1
			},
			{
				"id": "last",
				"name": "Last",
				"viewType": "cluster",
				"view": "events",
				"filters": {
					"kinds": {"mode":"none"},
					"namespaces": {"mode":"all"},
					"clusters": {"mode":"all"}
				},
				"tableState": {"sortColumn":"name","sortDirection":"asc","columnVisibility":{}},
				"order": 2
			}
		]
	}`), 0o644))

	favorites, err := app.GetFavorites()
	require.NoError(t, err)
	require.Len(t, favorites, 2)
	require.Equal(t, []string{"first", "last"}, []string{favorites[0].ID, favorites[1].ID})
	require.Equal(t, []int{0, 1}, []int{favorites[0].Order, favorites[1].Order})

	first := favorites[0]
	require.Equal(t, "alpha:context", first.ClusterID)
	require.Equal(t, "alpha", first.ClusterName)
	require.Equal(t, "deploy", first.Panes["main"].Filters.Search)
	require.Equal(t, FavoriteFilterSelection{Mode: "some", Values: []string{"Deployment"}}, first.Panes["main"].Filters.Kinds)
	require.Equal(t, FavoriteFilterSelection{Mode: "some", Values: []string{"apps"}}, first.Panes["main"].Filters.QueryFacets["apiGroups"])
	require.Equal(t, "kind", first.Panes["main"].TableState.SortColumn)
	require.Equal(t, map[string]bool{"namespace": false}, first.Panes["main"].TableState.ColumnVisibility)

	rewritten, err := os.ReadFile(path)
	require.NoError(t, err)
	rewrittenState := favoritesFile{}
	require.NoError(t, json.Unmarshal(rewritten, &rewrittenState))
	require.Equal(t, favoritesSchemaVersion, rewrittenState.SchemaVersion)
	require.Equal(t, []string{"first", "last"}, []string{rewrittenState.Favorites[0].ID, rewrittenState.Favorites[1].ID})
}

func TestLoadFavoritesFileMigratesV2WorkloadsAndPodsIntoBothPanes(t *testing.T) {
	setTestConfigEnv(t)
	app := newTestAppWithDefaults(t)
	path, err := app.getFavoritesFilePath()
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(path, []byte(`{
		"schemaVersion": 2,
		"favorites": [
			{
				"id":"workloads","name":"Workloads","viewType":"namespace","view":"workloads","namespace":"team-a",
				"filters":{"search":"api","kinds":{"mode":"some","values":["Deployment"]},"namespaces":{"mode":"all"},"clusters":{"mode":"all"}},
				"tableState":{"sortColumn":"kind","sortDirection":"desc","columnVisibility":{"cpu":false}},"order":0
			},
			{
				"id":"pods","name":"Pods","viewType":"namespace","view":"pods","namespace":"team-a",
				"filters":{"search":"worker","kinds":{"mode":"all"},"namespaces":{"mode":"all"},"clusters":{"mode":"all"},"queryFacets":{"nodes":{"mode":"some","values":["node-a"]}}},
				"tableState":{"sortColumn":"node","sortDirection":"asc","columnVisibility":{"memory":false}},"order":1
			}
		]
	}`), 0o644))

	state, err := app.loadFavoritesFile()
	require.NoError(t, err)
	require.Len(t, state.Favorites, 2)
	defaultPane := FavoritePaneState{
		Filters: FavoriteFilters{
			Kinds:      FavoriteFilterSelection{Mode: "all"},
			Namespaces: FavoriteFilterSelection{Mode: "all"},
			Clusters:   FavoriteFilterSelection{Mode: "all"},
		},
		TableState: FavoriteTableState{
			SortColumn:       "name",
			SortDirection:    "asc",
			ColumnVisibility: map[string]bool{},
		},
	}

	workloads := state.Favorites[0]
	require.Equal(t, "workloads", workloads.View)
	require.Equal(t, "api", workloads.Panes["workloads"].Filters.Search)
	require.Equal(t, "kind", workloads.Panes["workloads"].TableState.SortColumn)
	require.Equal(t, defaultPane, workloads.Panes["pods"])

	pods := state.Favorites[1]
	require.Equal(t, "workloads", pods.View)
	require.Equal(t, "worker", pods.Panes["pods"].Filters.Search)
	require.Equal(t, FavoriteFilterSelection{Mode: "some", Values: []string{"node-a"}}, pods.Panes["pods"].Filters.QueryFacets["nodes"])
	require.Equal(t, "node", pods.Panes["pods"].TableState.SortColumn)
	require.Equal(t, defaultPane, pods.Panes["workloads"])
}

func TestLoadFavoritesFileMigratesV1FavoritesLeftOnDiskByV2(t *testing.T) {
	setTestConfigEnv(t)
	app := newTestAppWithDefaults(t)
	path, err := app.getFavoritesFilePath()
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(path, []byte(`{
		"schemaVersion": 1,
		"favorites": [
			{
				"id": "pods",
				"name": "Pods",
				"clusterSelection": "/clusters/alpha",
				"clusterId": "alpha:context",
				"clusterName": "alpha",
				"viewType": "namespace",
				"view": "pods",
				"namespace": "team-a",
				"filters": {
					"search": "api",
					"kinds": [],
					"namespaces": ["team-a"],
					"queryFacets": {"nodes": ["node-a"]},
					"caseSensitive": true,
					"includeMetadata": false
				},
				"tableState": {"sortColumn":"node","sortDirection":"desc","columnVisibility":{"cpu":false}},
				"order": 0
			},
			{
				"id": "broken",
				"name": "Broken",
				"viewType": "cluster",
				"view": "nodes",
				"filters": "not-an-object",
				"tableState": {"sortColumn":"name","sortDirection":"asc"},
				"order": 1
			},
			{
				"id": "config",
				"name": "Config",
				"clusterSelection": "/clusters/alpha",
				"clusterId": "alpha:context",
				"clusterName": "alpha",
				"viewType": "namespace",
				"view": "config",
				"namespace": "team-a",
				"filters": {
					"search": "settings",
					"kinds": ["ConfigMap"],
					"namespaces": [],
					"queryFacets": {"apiGroups": []},
					"caseSensitive": false,
					"includeMetadata": true
				},
				"tableState": {"sortColumn":"name","sortDirection":"asc","columnVisibility":{}},
				"order": 2
			}
		]
	}`), 0o644))

	state, err := app.loadFavoritesFile()
	require.NoError(t, err)
	require.Equal(t, favoritesSchemaVersion, state.SchemaVersion)
	require.Len(t, state.Favorites, 2)
	require.Equal(t, []string{"pods", "config"}, []string{state.Favorites[0].ID, state.Favorites[1].ID})
	require.Equal(t, []int{0, 1}, []int{state.Favorites[0].Order, state.Favorites[1].Order})

	pods := state.Favorites[0]
	require.Equal(t, "workloads", pods.View)
	require.Equal(t, "alpha:context", pods.ClusterID)
	require.Equal(t, FavoriteFilterSelection{Mode: "all"}, pods.Panes["pods"].Filters.Kinds)
	require.Equal(t, FavoriteFilterSelection{Mode: "some", Values: []string{"team-a"}}, pods.Panes["pods"].Filters.Namespaces)
	require.Equal(t, FavoriteFilterSelection{Mode: "some", Values: []string{"node-a"}}, pods.Panes["pods"].Filters.QueryFacets["nodes"])
	require.Equal(t, "node", pods.Panes["pods"].TableState.SortColumn)

	config := state.Favorites[1]
	require.Equal(t, FavoriteFilterSelection{Mode: "some", Values: []string{"ConfigMap"}}, config.Panes["main"].Filters.Kinds)
	require.Equal(t, FavoriteFilterSelection{Mode: "all"}, config.Panes["main"].Filters.Namespaces)
	require.Equal(t, FavoriteFilterSelection{Mode: "all"}, config.Panes["main"].Filters.QueryFacets["apiGroups"])

	rewritten, err := os.ReadFile(path)
	require.NoError(t, err)
	rewrittenState := favoritesFile{}
	require.NoError(t, json.Unmarshal(rewritten, &rewrittenState))
	require.Equal(t, favoritesSchemaVersion, rewrittenState.SchemaVersion)
	require.Equal(t, []string{"pods", "config"}, []string{rewrittenState.Favorites[0].ID, rewrittenState.Favorites[1].ID})
}

func TestLoadFavoritesFileRejectsFutureSchema(t *testing.T) {
	setTestConfigEnv(t)
	app := newTestAppWithDefaults(t)
	path, err := app.getFavoritesFilePath()
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(path, []byte(`{"schemaVersion":999,"favorites":[]}`), 0o644))

	_, err = app.loadFavoritesFile()
	require.ErrorContains(t, err, "newer than supported")
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
