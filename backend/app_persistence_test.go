package backend

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/require"
)

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
