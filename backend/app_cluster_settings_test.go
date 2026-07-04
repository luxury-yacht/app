package backend

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestGetClusterAllowedNamespacesEmptyByDefault(t *testing.T) {
	setTestConfigEnv(t)
	app := newTestAppWithDefaults(t)

	namespaces, err := app.GetClusterAllowedNamespaces("kc:ctx")
	require.NoError(t, err)
	require.Empty(t, namespaces)
}

func TestSetClusterAllowedNamespacesPersistsPerCluster(t *testing.T) {
	setTestConfigEnv(t)
	app := newTestAppWithDefaults(t)

	_, err := app.SetClusterAllowedNamespaces("kc:alpha", []string{"prod", "staging"})
	require.NoError(t, err)
	_, err = app.SetClusterAllowedNamespaces("kc:beta", []string{"dev"})
	require.NoError(t, err)

	alpha, err := app.GetClusterAllowedNamespaces("kc:alpha")
	require.NoError(t, err)
	require.Equal(t, []string{"prod", "staging"}, alpha)

	beta, err := app.GetClusterAllowedNamespaces("kc:beta")
	require.NoError(t, err)
	require.Equal(t, []string{"dev"}, beta)

	// The section must be on disk, not only in memory: a fresh load sees it.
	file, err := app.loadSettingsFile()
	require.NoError(t, err)
	require.Equal(t, []string{"prod", "staging"}, file.Clusters["kc:alpha"].AllowedNamespaces)
	require.Equal(t, []string{"dev"}, file.Clusters["kc:beta"].AllowedNamespaces)
}

func TestSetClusterAllowedNamespacesNormalizes(t *testing.T) {
	setTestConfigEnv(t)
	app := newTestAppWithDefaults(t)

	normalized, err := app.SetClusterAllowedNamespaces("kc:ctx", []string{" prod ", "prod", "", "dev"})
	require.NoError(t, err)
	require.Equal(t, []string{"prod", "dev"}, normalized)

	stored, err := app.GetClusterAllowedNamespaces("kc:ctx")
	require.NoError(t, err)
	require.Equal(t, []string{"prod", "dev"}, stored)
}

func TestSetClusterAllowedNamespacesRejectsInvalidName(t *testing.T) {
	setTestConfigEnv(t)
	app := newTestAppWithDefaults(t)

	_, err := app.SetClusterAllowedNamespaces("kc:ctx", []string{"prod", "Not_Valid!"})
	require.ErrorContains(t, err, "Not_Valid!")

	// The whole batch is rejected: nothing persisted.
	stored, getErr := app.GetClusterAllowedNamespaces("kc:ctx")
	require.NoError(t, getErr)
	require.Empty(t, stored)
}

func TestSetClusterAllowedNamespacesRequiresClusterID(t *testing.T) {
	setTestConfigEnv(t)
	app := newTestAppWithDefaults(t)

	_, err := app.SetClusterAllowedNamespaces("", []string{"prod"})
	require.Error(t, err)
}

func TestSetClusterAllowedNamespacesClearsEntryWhenEmpty(t *testing.T) {
	setTestConfigEnv(t)
	app := newTestAppWithDefaults(t)

	_, err := app.SetClusterAllowedNamespaces("kc:ctx", []string{"prod"})
	require.NoError(t, err)
	_, err = app.SetClusterAllowedNamespaces("kc:ctx", nil)
	require.NoError(t, err)

	stored, err := app.GetClusterAllowedNamespaces("kc:ctx")
	require.NoError(t, err)
	require.Empty(t, stored)

	file, err := app.loadSettingsFile()
	require.NoError(t, err)
	_, exists := file.Clusters["kc:ctx"]
	require.False(t, exists, "cleared cluster entry must be removed from settings.json")
}

func TestClusterAllowedNamespacesSurviveSaveAppSettings(t *testing.T) {
	setTestConfigEnv(t)
	app := newTestAppWithDefaults(t)

	_, err := app.SetClusterAllowedNamespaces("kc:ctx", []string{"prod"})
	require.NoError(t, err)

	// A global-preferences save (load-mutate-save) must not drop the
	// per-cluster section.
	require.NoError(t, app.loadAppSettings())
	require.NoError(t, app.saveAppSettings())

	stored, err := app.GetClusterAllowedNamespaces("kc:ctx")
	require.NoError(t, err)
	require.Equal(t, []string{"prod"}, stored)
}

func TestSetClusterAllowedNamespacesRequestsRebuildOnlyOnChange(t *testing.T) {
	setTestConfigEnv(t)
	app := newTestAppWithDefaults(t)

	var rebuilt []string
	app.requestClusterScopeRebuildFn = func(clusterID string) {
		rebuilt = append(rebuilt, clusterID)
	}

	_, err := app.SetClusterAllowedNamespaces("kc:ctx", []string{"prod", "dev"})
	require.NoError(t, err)
	require.Equal(t, []string{"kc:ctx"}, rebuilt, "first set must rebuild the affected cluster")

	// Same set, same order: no rebuild.
	_, err = app.SetClusterAllowedNamespaces("kc:ctx", []string{"prod", "dev"})
	require.NoError(t, err)
	require.Len(t, rebuilt, 1, "unchanged scope must not rebuild")

	// Same set, different order: scope semantics unchanged, no rebuild.
	_, err = app.SetClusterAllowedNamespaces("kc:ctx", []string{"dev", "prod"})
	require.NoError(t, err)
	require.Len(t, rebuilt, 1, "reordered scope must not rebuild")

	// Removing a namespace is a change.
	_, err = app.SetClusterAllowedNamespaces("kc:ctx", []string{"dev"})
	require.NoError(t, err)
	require.Equal(t, []string{"kc:ctx", "kc:ctx"}, rebuilt)

	// A failed set must not rebuild.
	_, err = app.SetClusterAllowedNamespaces("kc:ctx", []string{"Bad!"})
	require.Error(t, err)
	require.Len(t, rebuilt, 2)
}

func TestAllowedNamespacesForClusterReadsPersistedScope(t *testing.T) {
	setTestConfigEnv(t)
	app := newTestAppWithDefaults(t)

	require.Empty(t, app.allowedNamespacesForCluster("kc:ctx"))

	_, err := app.SetClusterAllowedNamespaces("kc:ctx", []string{"prod", "dev"})
	require.NoError(t, err)
	require.Equal(t, []string{"prod", "dev"}, app.allowedNamespacesForCluster("kc:ctx"))
	require.Empty(t, app.allowedNamespacesForCluster("kc:other"))
}
