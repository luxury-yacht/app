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
