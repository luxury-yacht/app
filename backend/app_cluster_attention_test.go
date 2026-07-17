package backend

import (
	"testing"

	"github.com/luxury-yacht/app/backend/refresh/snapshot"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/stretchr/testify/require"
)

func attentionIgnoredRef(clusterID, uid string) resourcemodel.ResourceRef {
	return resourcemodel.ResourceRef{
		ClusterID: clusterID,
		Group:     "apps",
		Version:   "v1",
		Kind:      "Deployment",
		Resource:  "deployments",
		Namespace: "payments",
		Name:      "checkout",
		UID:       uid,
	}
}

func TestClusterAttentionIgnoresPersistPerCluster(t *testing.T) {
	setTestConfigEnv(t)
	app := newTestAppWithDefaults(t)
	alpha := attentionIgnoredRef("cluster-a", "uid-a")
	beta := attentionIgnoredRef("cluster-b", "uid-b")

	_, err := app.IgnoreClusterAttentionObject("cluster-a", alpha)
	require.NoError(t, err)
	_, err = app.IgnoreClusterAttentionFindingType("cluster-a", "restarts")
	require.NoError(t, err)
	_, err = app.IgnoreClusterAttentionObject("cluster-b", beta)
	require.NoError(t, err)

	alphaRules, err := app.GetClusterAttentionIgnoreRules("cluster-a")
	require.NoError(t, err)
	require.Equal(t, []resourcemodel.ResourceRef{alpha}, alphaRules.IgnoredObjects)
	require.Equal(t, []string{"restarts"}, alphaRules.FindingTypes)
	betaRules, err := app.GetClusterAttentionIgnoreRules("cluster-b")
	require.NoError(t, err)
	require.Equal(t, []resourcemodel.ResourceRef{beta}, betaRules.IgnoredObjects)
	require.Empty(t, betaRules.FindingTypes)
}

func TestClusterAttentionIgnoreObjectRequiresExactClusterIdentity(t *testing.T) {
	setTestConfigEnv(t)
	app := newTestAppWithDefaults(t)

	_, err := app.IgnoreClusterAttentionObject("cluster-a", attentionIgnoredRef("cluster-b", "uid-a"))
	require.ErrorContains(t, err, "clusterId")
	_, err = app.IgnoreClusterAttentionObject("cluster-a", attentionIgnoredRef("cluster-a", ""))
	require.ErrorContains(t, err, "uid")

	rules, getErr := app.GetClusterAttentionIgnoreRules("cluster-a")
	require.NoError(t, getErr)
	require.Empty(t, rules.IgnoredObjects)
}

func TestClusterAttentionIgnoreFindingTypeUsesCentralCatalog(t *testing.T) {
	setTestConfigEnv(t)
	app := newTestAppWithDefaults(t)

	_, err := app.IgnoreClusterAttentionFindingType("cluster-a", "not-a-finding-type")
	require.ErrorContains(t, err, "unknown Attention finding type")
	rules, getErr := app.GetClusterAttentionIgnoreRules("cluster-a")
	require.NoError(t, getErr)
	require.Empty(t, rules.FindingTypes)
}

func TestClusterAttentionCanRestoreATypeRemovedFromTheCatalog(t *testing.T) {
	setTestConfigEnv(t)
	app := newTestAppWithDefaults(t)
	settings, err := app.loadSettingsFile()
	require.NoError(t, err)
	settings.Clusters = map[string]settingsClusterSection{
		"cluster-a": {Attention: &snapshot.AttentionIgnoreRules{FindingTypes: []string{"removed-type"}}},
	}
	require.NoError(t, app.saveSettingsFile(settings))

	_, err = app.RestoreClusterAttentionFindingType("cluster-a", "removed-type")
	require.NoError(t, err)
	rules, err := app.GetClusterAttentionIgnoreRules("cluster-a")
	require.NoError(t, err)
	require.Empty(t, rules.FindingTypes)
}

func TestClusterAttentionIgnoreMutationsPreserveNamespaceScope(t *testing.T) {
	setTestConfigEnv(t)
	app := newTestAppWithDefaults(t)
	ref := attentionIgnoredRef("cluster-a", "uid-a")

	_, err := app.SetClusterAllowedNamespaces("cluster-a", []string{"payments"})
	require.NoError(t, err)
	_, err = app.IgnoreClusterAttentionObject("cluster-a", ref)
	require.NoError(t, err)
	_, err = app.SetClusterAllowedNamespaces("cluster-a", nil)
	require.NoError(t, err)

	rules, err := app.GetClusterAttentionIgnoreRules("cluster-a")
	require.NoError(t, err)
	require.Equal(t, []resourcemodel.ResourceRef{ref}, rules.IgnoredObjects)
	file, err := app.loadSettingsFile()
	require.NoError(t, err)
	require.Contains(t, file.Clusters, "cluster-a")
}

func TestPruneClusterAttentionIgnoredObjectRemovesOnlyObsoleteIdentity(t *testing.T) {
	setTestConfigEnv(t)
	app := newTestAppWithDefaults(t)
	obsolete := attentionIgnoredRef("cluster-a", "uid-old")
	current := attentionIgnoredRef("cluster-a", "uid-current")
	current.Name = "current"

	_, err := app.IgnoreClusterAttentionObject("cluster-a", obsolete)
	require.NoError(t, err)
	_, err = app.IgnoreClusterAttentionObject("cluster-a", current)
	require.NoError(t, err)
	_, err = app.IgnoreClusterAttentionFindingType("cluster-a", "restarts")
	require.NoError(t, err)

	require.NoError(t, app.pruneClusterAttentionIgnoredObject("cluster-a", obsolete))
	rules, err := app.GetClusterAttentionIgnoreRules("cluster-a")
	require.NoError(t, err)
	require.Equal(t, []resourcemodel.ResourceRef{current}, rules.IgnoredObjects)
	require.Equal(t, []string{"restarts"}, rules.FindingTypes)
}

func TestClusterAttentionRestoreRemovesEmptyClusterSection(t *testing.T) {
	setTestConfigEnv(t)
	app := newTestAppWithDefaults(t)
	ref := attentionIgnoredRef("cluster-a", "uid-a")
	_, err := app.IgnoreClusterAttentionObject("cluster-a", ref)
	require.NoError(t, err)

	_, err = app.RestoreClusterAttentionObject("cluster-a", ref)
	require.NoError(t, err)
	file, err := app.loadSettingsFile()
	require.NoError(t, err)
	require.NotContains(t, file.Clusters, "cluster-a")
}
