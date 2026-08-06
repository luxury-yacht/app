/*
 * backend/cluster_auth_test.go
 *
 * Tests for per-cluster auth subsystem rebuild wiring.
 */

package backend

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/luxury-yacht/app/backend/internal/authstate"
	"github.com/luxury-yacht/app/backend/refresh/system"
	"github.com/stretchr/testify/require"
)

// TestRebuildClusterSubsystemPreservesAuthManagerWiring reproduces the
// "zombie manager" failure: rebuildClusterSubsystem used to build new clients
// around a freshly created auth manager, shut that manager down, and swap the
// old manager onto the struct — leaving every rebuilt transport reporting to
// a dead manager. A 401 after any rebuild then blocked all traffic forever
// while the tracked manager stayed valid, so RetryClusterAuth was a no-op.
//
// The contract: after a rebuild, the clients stored for the cluster must
// track the SAME manager as before, and auth failures seen by the rebuilt
// transports must transition that manager.
func TestRebuildClusterSubsystemPreservesAuthManagerWiring(t *testing.T) {
	// The server rejects everything with 401: the rebuild's preflight check
	// reports the credential failure through the transport under test and
	// rebuildClusterSubsystem stops before building a refresh subsystem.
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer server.Close()

	app := newTestAppWithDefaults(t)
	app.Ctx = context.Background()
	app.clusterOps = newClusterOperationCoordinator()
	configPath := writeTestKubeconfig(t, server.URL)

	app.availableKubeconfigs = []KubeconfigInfo{
		{Name: "config", Path: configPath, Context: "test-context"},
	}
	app.selectedKubeconfigs = []string{configPath + ":test-context"}

	meta := app.clusterMetaForSelection(kubeconfigSelection{Path: configPath, Context: "test-context"})
	require.NotEmpty(t, meta.ID)

	originalMgr := authstate.New(authstate.Config{MaxAttempts: 0})
	defer originalMgr.Shutdown()

	app.clusterClients = map[string]*clusterClients{
		meta.ID: {
			meta:              meta,
			kubeconfigPath:    configPath,
			kubeconfigContext: "test-context",
			authManager:       originalMgr,
		},
	}

	app.rebuildClusterSubsystem(meta.ID)

	rebuilt := app.clusterClientsForID(meta.ID)
	require.NotNil(t, rebuilt)
	require.Same(t, originalMgr, rebuilt.authManager,
		"rebuild must keep tracking the original auth manager")

	// The preflight 401 travelled through the rebuilt transport; it must have
	// reached the original manager, not a discarded internal one.
	state, _ := originalMgr.State()
	require.Equal(t, authstate.StateInvalid, state,
		"auth failures seen by rebuilt transports must transition the tracked manager")
}

func TestRebuildClusterSubsystemGuardsMissingInputs(t *testing.T) {
	var nilApp *App
	nilApp.rebuildClusterSubsystem("cluster-a")

	app := newTestAppWithDefaults(t)
	app.rebuildClusterSubsystem("")
	app.rebuildClusterSubsystem("missing")

	app.clusterClients = make(map[string]*clusterClients)
	app.clusterClients["cluster-a"] = &clusterClients{meta: ClusterMeta{ID: "cluster-a", Name: "Cluster A"}}
	app.rebuildClusterSubsystem("cluster-a")
}

func TestClusterSubsystemRebuildHelperPaths(t *testing.T) {
	app := newTestAppWithDefaults(t)
	rebuild := clusterSubsystemRebuild{
		app: app, clusterID: "cluster-a", clusterName: "Cluster A",
		selection:  kubeconfigSelection{Path: "/missing/config", Context: "ctx"},
		oldClients: &clusterClients{meta: ClusterMeta{ID: "cluster-a", Name: "Cluster A"}},
	}

	clients, ok := rebuild.rebuildClients()
	require.False(t, ok)
	require.Nil(t, clients)

	rebuild.startManager(&system.Subsystem{})
	app.refreshCtx = context.Background()
	rebuild.startManager(&system.Subsystem{})

	subsystems, order := refreshSubsystemTopology(map[string]*system.Subsystem{
		"cluster-b": {},
		"cluster-a": {},
	})
	require.Len(t, subsystems, 2)
	require.ElementsMatch(t, []string{"cluster-a", "cluster-b"}, order)

	app.refreshHTTPServer = &http.Server{}
	app.refreshAggregates.Store(&refreshAggregateHandlers{})
	require.True(t, rebuild.updateRefreshRouting(subsystems, order))

	rebuild.startObjectCatalog(&clusterClients{meta: rebuild.oldClients.meta})
}

func TestClusterClientsAuthInvalid(t *testing.T) {
	require.False(t, clusterClientsAuthInvalid(&clusterClients{}))
	require.True(t, clusterClientsAuthInvalid(&clusterClients{authFailedOnInit: true}))

	manager := authstate.New(authstate.Config{MaxAttempts: 0})
	t.Cleanup(manager.Shutdown)
	manager.ReportFailure("expired")
	require.True(t, clusterClientsAuthInvalid(&clusterClients{authManager: manager}))
}
