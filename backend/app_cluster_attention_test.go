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

	_, err := app.IgnoreClusterAttentionObjectFinding("cluster-a", alpha, "restarts")
	require.NoError(t, err)
	_, err = app.IgnoreClusterAttentionFindingType("cluster-a", "restarts")
	require.NoError(t, err)
	_, err = app.IgnoreClusterAttentionObjectFinding("cluster-b", beta, "restarts")
	require.NoError(t, err)

	alphaRules, err := app.GetClusterAttentionIgnoreRules("cluster-a")
	require.NoError(t, err)
	require.Equal(t, []snapshot.AttentionObjectFindingIgnore{{Ref: alpha, FindingType: "restarts"}}, alphaRules.ObjectFindings)
	require.Equal(t, []string{"restarts"}, alphaRules.ClusterFindingTypes)
	betaRules, err := app.GetClusterAttentionIgnoreRules("cluster-b")
	require.NoError(t, err)
	require.Equal(t, []snapshot.AttentionObjectFindingIgnore{{Ref: beta, FindingType: "restarts"}}, betaRules.ObjectFindings)
	require.Empty(t, betaRules.ClusterFindingTypes)
}

func TestClusterAttentionIgnoreObjectRequiresExactClusterIdentity(t *testing.T) {
	setTestConfigEnv(t)
	app := newTestAppWithDefaults(t)

	_, err := app.IgnoreClusterAttentionObjectFinding("cluster-a", attentionIgnoredRef("cluster-b", "uid-a"), "restarts")
	require.ErrorContains(t, err, "clusterId")
	_, err = app.IgnoreClusterAttentionObjectFinding("cluster-a", attentionIgnoredRef("cluster-a", ""), "restarts")
	require.ErrorContains(t, err, "uid")

	rules, getErr := app.GetClusterAttentionIgnoreRules("cluster-a")
	require.NoError(t, getErr)
	require.Empty(t, rules.ObjectFindings)
}

func TestClusterAttentionIgnoreFindingTypeUsesCentralCatalog(t *testing.T) {
	setTestConfigEnv(t)
	app := newTestAppWithDefaults(t)

	_, err := app.IgnoreClusterAttentionFindingType("cluster-a", "not-a-finding-type")
	require.ErrorContains(t, err, "unknown Attention finding type")
	rules, getErr := app.GetClusterAttentionIgnoreRules("cluster-a")
	require.NoError(t, getErr)
	require.Empty(t, rules.ClusterFindingTypes)
}

func TestClusterAttentionCanRestoreATypeRemovedFromTheCatalog(t *testing.T) {
	setTestConfigEnv(t)
	app := newTestAppWithDefaults(t)
	settings, err := app.loadSettingsFile()
	require.NoError(t, err)
	settings.Clusters = map[string]settingsClusterSection{
		"cluster-a": {Attention: &settingsClusterAttentionRules{FindingTypes: []string{"removed-type"}}},
	}
	require.NoError(t, app.saveSettingsFile(settings))

	_, err = app.RestoreClusterAttentionFindingType("cluster-a", "removed-type")
	require.NoError(t, err)
	rules, err := app.GetClusterAttentionIgnoreRules("cluster-a")
	require.NoError(t, err)
	require.Empty(t, rules.ClusterFindingTypes)
}

func TestClusterAttentionIgnoreMutationsPreserveNamespaceScope(t *testing.T) {
	setTestConfigEnv(t)
	app := newTestAppWithDefaults(t)
	ref := attentionIgnoredRef("cluster-a", "uid-a")

	_, err := app.SetClusterAllowedNamespaces("cluster-a", []string{"payments"})
	require.NoError(t, err)
	_, err = app.IgnoreClusterAttentionObjectFinding("cluster-a", ref, "restarts")
	require.NoError(t, err)
	_, err = app.SetClusterAllowedNamespaces("cluster-a", nil)
	require.NoError(t, err)

	rules, err := app.GetClusterAttentionIgnoreRules("cluster-a")
	require.NoError(t, err)
	require.Equal(t, []snapshot.AttentionObjectFindingIgnore{{Ref: ref, FindingType: "restarts"}}, rules.ObjectFindings)
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

	_, err := app.IgnoreClusterAttentionObjectFinding("cluster-a", obsolete, "restarts")
	require.NoError(t, err)
	_, err = app.IgnoreClusterAttentionObjectFinding("cluster-a", current, "replica-mismatch")
	require.NoError(t, err)
	_, err = app.IgnoreClusterAttentionFindingType("cluster-a", "restarts")
	require.NoError(t, err)

	require.NoError(t, app.pruneClusterAttentionIgnoredObject("cluster-a", obsolete))
	rules, err := app.GetClusterAttentionIgnoreRules("cluster-a")
	require.NoError(t, err)
	require.Equal(t, []snapshot.AttentionObjectFindingIgnore{{Ref: current, FindingType: "replica-mismatch"}}, rules.ObjectFindings)
	require.Equal(t, []string{"restarts"}, rules.ClusterFindingTypes)
}

func TestClusterAttentionRestoreRemovesEmptyClusterSection(t *testing.T) {
	setTestConfigEnv(t)
	app := newTestAppWithDefaults(t)
	ref := attentionIgnoredRef("cluster-a", "uid-a")
	_, err := app.IgnoreClusterAttentionObjectFinding("cluster-a", ref, "restarts")
	require.NoError(t, err)

	_, err = app.RestoreClusterAttentionObjectFinding("cluster-a", ref, "restarts")
	require.NoError(t, err)
	file, err := app.loadSettingsFile()
	require.NoError(t, err)
	require.NotContains(t, file.Clusters, "cluster-a")
}

func TestAttentionIgnoreScopesPersistWithExactMeaning(t *testing.T) {
	setTestConfigEnv(t)
	app := newTestAppWithDefaults(t)
	ref := attentionIgnoredRef("cluster-a", "uid-a")

	_, err := app.IgnoreClusterAttentionObjectFinding("cluster-a", ref, "restarts")
	require.NoError(t, err)
	_, err = app.IgnoreClusterAttentionFindingType("cluster-a", "replica-mismatch")
	require.NoError(t, err)
	_, err = app.IgnoreGlobalAttentionFindingType("cluster-a", "warning-event")
	require.NoError(t, err)

	alphaRules, err := app.GetClusterAttentionIgnoreRules("cluster-a")
	require.NoError(t, err)
	require.Equal(t, []snapshot.AttentionObjectFindingIgnore{{Ref: ref, FindingType: "restarts"}}, alphaRules.ObjectFindings)
	require.Equal(t, []string{"replica-mismatch"}, alphaRules.ClusterFindingTypes)
	require.Equal(t, []string{"warning-event"}, alphaRules.GlobalFindingTypes)

	betaRules, err := app.GetClusterAttentionIgnoreRules("cluster-b")
	require.NoError(t, err)
	require.Empty(t, betaRules.ObjectFindings)
	require.Empty(t, betaRules.ClusterFindingTypes)
	require.Equal(t, []string{"warning-event"}, betaRules.GlobalFindingTypes)

	settings, err := app.loadSettingsFile()
	require.NoError(t, err)
	require.Equal(t, []string{"warning-event"}, settings.Attention.FindingTypes)
	require.Equal(t, []string{"replica-mismatch"}, settings.Clusters["cluster-a"].Attention.FindingTypes)
}
