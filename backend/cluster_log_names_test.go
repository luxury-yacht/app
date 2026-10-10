package backend

import (
	"context"
	"strings"
	"testing"

	"github.com/luxury-yacht/app/backend/refresh/snapshot"
	"github.com/luxury-yacht/app/backend/refresh/system"
	"github.com/stretchr/testify/require"
)

// App Logs label each line with the cluster's name (its kubeconfig context) and
// fall back to the cluster ID only when no name is known. These paths used to
// pass the ID in the name slot, so their lines read "[file:context]".
const (
	logNameTestClusterID   = "dev-config:dev-context"
	logNameTestClusterName = "dev-context"
)

type ignoredAttentionRulesTarget struct{}

func (ignoredAttentionRulesTarget) SetIgnoreRules(snapshot.AttentionIgnoreRules) {}

// requireClusterLogNames asserts that count entries for the cluster start with
// prefix and that each carries the expected cluster name.
func requireClusterLogNames(t *testing.T, logger *Logger, clusterID, prefix string, count int, wantName string) {
	t.Helper()
	var matches []LogEntry
	for _, entry := range logger.GetEntries() {
		if entry.ClusterID == clusterID && strings.HasPrefix(entry.Message, prefix) {
			matches = append(matches, entry)
		}
	}
	require.Len(t, matches, count, "%q entries for %s", prefix, clusterID)
	for _, entry := range matches {
		require.Equal(t, wantName, entry.ClusterName, "cluster name slot for %q", entry.Message)
	}
}

func TestClusterSettingsReadFailuresLogTheClusterName(t *testing.T) {
	setTestConfigEnv(t)
	app := newWorkspaceCoordinatorTestFixture(t)
	app.ClusterRuntime.clusterClients = map[string]*clusterClients{
		logNameTestClusterID: {meta: ClusterMeta{ID: logNameTestClusterID, Name: logNameTestClusterName}},
	}
	settingsPath, err := app.Preferences.getSettingsFilePath()
	require.NoError(t, err)
	writeTestFileWithParents(t, settingsPath, []byte("{not json"), 0o644)

	require.Empty(t, app.Refresh.refreshAllowedNamespaces(logNameTestClusterID))
	require.Equal(t, snapshot.AttentionIgnoreRules{}, app.Attention.attentionIgnoreRulesForCluster(logNameTestClusterID))
	app.Attention.RegisterTarget(logNameTestClusterID, ignoredAttentionRulesTarget{})

	logger := app.AppLogs.Logger()
	requireClusterLogNames(t, logger, logNameTestClusterID, "Could not read allowed namespaces", 1, logNameTestClusterName)
	requireClusterLogNames(t, logger, logNameTestClusterID, "Could not read Attention ignores", 2, logNameTestClusterName)
}

func TestAuthRecoveryLogsTheClusterName(t *testing.T) {
	app := newWorkspaceCoordinatorTestFixture(t)
	setTestAppRuntimeReady(t, app.Lifecycle, context.Background())
	app.ClusterRuntime.clusterClients = map[string]*clusterClients{
		logNameTestClusterID: {meta: ClusterMeta{ID: logNameTestClusterID, Name: logNameTestClusterName}},
	}
	app.Refresh.refreshSubsystems = map[string]*system.Subsystem{logNameTestClusterID: {}}

	app.Refresh.teardownClusterSubsystem(logNameTestClusterID)
	// The clients have no kubeconfig selection, so the rebuild stops after
	// logging; no cluster is contacted.
	app.Refresh.rebuildClusterSubsystem(logNameTestClusterID)

	logger := app.AppLogs.Logger()
	requireClusterLogNames(t, logger, logNameTestClusterID, "Tearing down subsystem", 1, logNameTestClusterName)
	requireClusterLogNames(t, logger, logNameTestClusterID, "Rebuilding subsystem", 1, logNameTestClusterName)
}

// A rebuild can be requested before the cluster's clients exist (for example a
// governor re-warm racing the first connect). The name then comes from
// kubeconfig discovery; only a cluster that is not discovered at all has none.
func TestRebuildBeforeClientsExistLogsTheDiscoveredClusterName(t *testing.T) {
	app := newWorkspaceCoordinatorTestFixture(t)
	app.ClusterRuntime.availableKubeconfigs = []KubeconfigInfo{
		{Name: "dev-config", Path: "/kube/dev-config", Context: logNameTestClusterName},
	}

	app.Refresh.rebuildClusterSubsystem(logNameTestClusterID)
	app.Refresh.rebuildClusterSubsystem("gone-config:gone-context")

	logger := app.AppLogs.Logger()
	requireClusterLogNames(t, logger, logNameTestClusterID, "Rebuilding subsystem", 1, logNameTestClusterName)
	requireClusterLogNames(t, logger, logNameTestClusterID, "Cannot rebuild subsystem", 1, logNameTestClusterName)
	requireClusterLogNames(t, logger, "gone-config:gone-context", "Cannot rebuild subsystem", 1, "")
}

func TestAttentionPruneFailureLogsTheClusterName(t *testing.T) {
	app := newWorkspaceCoordinatorTestFixture(t)
	var capturedCfg system.Config
	original := newRefreshSubsystemWithServices
	newRefreshSubsystemWithServices = func(_ context.Context, cfg system.Config) (*system.Subsystem, error) {
		capturedCfg = cfg
		return &system.Subsystem{}, nil
	}
	t.Cleanup(func() { newRefreshSubsystemWithServices = original })

	meta := ClusterMeta{ID: logNameTestClusterID, Name: logNameTestClusterName}
	selection := kubeconfigSelection{Path: "dev-config", Context: "dev-context"}
	_, err := app.Refresh.buildRefreshSubsystemForSelection(context.Background(), selection, &clusterClients{meta: meta}, meta)
	require.NoError(t, err)
	require.NotNil(t, capturedCfg.AttentionIgnoredObjectPruner)

	// A ref from another cluster is rejected, so the prune fails and warns.
	capturedCfg.AttentionIgnoredObjectPruner(attentionIgnoredRef("other-config:other-context", "uid-a"))

	requireClusterLogNames(t, app.AppLogs.Logger(), logNameTestClusterID, "Could not prune obsolete Attention ignore", 1, logNameTestClusterName)
}
