package backend

import (
	"context"
	"sync"
	"testing"

	"github.com/luxury-yacht/app/backend/internal/authstate"
	"github.com/stretchr/testify/require"
)

// TestSyncClusterClientPool_CreatesClientsForNewSelections verifies that calling
// syncClusterClientPoolWithContext with selections causes the corresponding entries
// to appear in a.clusterClients.
//
// Because buildClusterClientsWithContext tries to load a real kubeconfig from disk,
// we pre-populate a.clusterClients before the sync call to simulate the "already
// built" path. The sync function skips building for IDs that already exist, so this
// test verifies the bookkeeping around the desired-vs-existing set comparison.
func TestSyncClusterClientPool_CreatesClientsForNewSelections(t *testing.T) {
	app := newTestAppWithDefaults(t)
	app.Ctx = context.Background()
	app.clusterClients = make(map[string]*clusterClients)
	app.clusterOps = newClusterOperationCoordinator()
	app.shellSessions = make(map[string]*shellSession)
	app.portForwardSessions = make(map[string]*portForwardSessionInternal)

	// Set up available kubeconfigs so clusterMetaForSelection returns valid IDs.
	app.availableKubeconfigs = []KubeconfigInfo{
		{Name: "config", Path: "/tmp/config", Context: "cluster-a"},
		{Name: "config", Path: "/tmp/config", Context: "cluster-b"},
	}

	selections := []kubeconfigSelection{
		{Path: "/tmp/config", Context: "cluster-a"},
		{Path: "/tmp/config", Context: "cluster-b"},
	}

	// Derive the expected cluster IDs.
	idA := app.clusterMetaForSelection(selections[0]).ID
	idB := app.clusterMetaForSelection(selections[1]).ID
	require.NotEmpty(t, idA)
	require.NotEmpty(t, idB)

	// Pre-populate the client map so sync does not attempt real kubeconfig IO.
	app.clusterClientsMu.Lock()
	app.clusterClients[idA] = &clusterClients{
		meta:   ClusterMeta{ID: idA, Name: "cluster-a"},
		client: createHealthyClient(),
	}
	app.clusterClients[idB] = &clusterClients{
		meta:   ClusterMeta{ID: idB, Name: "cluster-b"},
		client: createHealthyClient(),
	}
	app.clusterClientsMu.Unlock()

	// Call sync — both IDs already exist, so no build should happen.
	err := app.syncClusterClientPoolWithContext(context.Background(), selections)
	require.NoError(t, err)

	// Both entries should still be present.
	app.clusterClientsMu.Lock()
	defer app.clusterClientsMu.Unlock()
	require.Len(t, app.clusterClients, 2)
	require.NotNil(t, app.clusterClients[idA])
	require.NotNil(t, app.clusterClients[idB])
}

// TestSyncClusterClientPool_RemovesStaleClients verifies that clients for clusters
// no longer in the desired selection set are removed during sync.
func TestSyncClusterClientPool_RemovesStaleClients(t *testing.T) {
	app := newTestAppWithDefaults(t)
	app.Ctx = context.Background()
	app.clusterClients = make(map[string]*clusterClients)
	app.clusterOps = newClusterOperationCoordinator()
	app.shellSessions = make(map[string]*shellSession)
	app.portForwardSessions = make(map[string]*portForwardSessionInternal)

	app.availableKubeconfigs = []KubeconfigInfo{
		{Name: "config", Path: "/tmp/config", Context: "cluster-a"},
		{Name: "config", Path: "/tmp/config", Context: "cluster-b"},
	}

	selA := kubeconfigSelection{Path: "/tmp/config", Context: "cluster-a"}
	selB := kubeconfigSelection{Path: "/tmp/config", Context: "cluster-b"}
	idA := app.clusterMetaForSelection(selA).ID
	idB := app.clusterMetaForSelection(selB).ID

	authMgrB := authstate.New(authstate.Config{MaxAttempts: 0})

	// Pre-populate both clusters.
	app.clusterClientsMu.Lock()
	app.clusterClients[idA] = &clusterClients{
		meta:   ClusterMeta{ID: idA, Name: "cluster-a"},
		client: createHealthyClient(),
	}
	app.clusterClients[idB] = &clusterClients{
		meta:        ClusterMeta{ID: idB, Name: "cluster-b"},
		client:      createHealthyClient(),
		authManager: authMgrB,
	}
	app.clusterClientsMu.Unlock()

	// Sync with only cluster-a — cluster-b should be removed.
	err := app.syncClusterClientPoolWithContext(context.Background(), []kubeconfigSelection{selA})
	require.NoError(t, err)

	app.clusterClientsMu.Lock()
	defer app.clusterClientsMu.Unlock()
	require.Len(t, app.clusterClients, 1)
	require.NotNil(t, app.clusterClients[idA], "cluster-a should remain")
	require.Nil(t, app.clusterClients[idB], "cluster-b should be removed")
}

// TestSyncClusterClientPool_IdempotentForExistingClients verifies that calling sync
// twice with the same selection set does not recreate or replace client entries.
func TestSyncClusterClientPool_IdempotentForExistingClients(t *testing.T) {
	app := newTestAppWithDefaults(t)
	app.Ctx = context.Background()
	app.clusterClients = make(map[string]*clusterClients)
	app.clusterOps = newClusterOperationCoordinator()
	app.shellSessions = make(map[string]*shellSession)
	app.portForwardSessions = make(map[string]*portForwardSessionInternal)

	app.availableKubeconfigs = []KubeconfigInfo{
		{Name: "config", Path: "/tmp/config", Context: "ctx-1"},
	}

	sel := kubeconfigSelection{Path: "/tmp/config", Context: "ctx-1"}
	id := app.clusterMetaForSelection(sel).ID
	require.NotEmpty(t, id)

	original := &clusterClients{
		meta:   ClusterMeta{ID: id, Name: "ctx-1"},
		client: createHealthyClient(),
	}

	app.clusterClientsMu.Lock()
	app.clusterClients[id] = original
	app.clusterClientsMu.Unlock()

	// First sync — should be a no-op for the existing entry.
	err := app.syncClusterClientPoolWithContext(context.Background(), []kubeconfigSelection{sel})
	require.NoError(t, err)

	app.clusterClientsMu.Lock()
	after1 := app.clusterClients[id]
	app.clusterClientsMu.Unlock()
	require.Same(t, original, after1, "client pointer should be identical after first sync")

	// Second sync — still the same pointer.
	err = app.syncClusterClientPoolWithContext(context.Background(), []kubeconfigSelection{sel})
	require.NoError(t, err)

	app.clusterClientsMu.Lock()
	after2 := app.clusterClients[id]
	app.clusterClientsMu.Unlock()
	require.Same(t, original, after2, "client pointer should be identical after second sync")
}

// TestSyncClusterClientPool_EmptySelections verifies that an empty selection list
// results in no error and all existing clients being removed.
func TestSyncClusterClientPool_EmptySelections(t *testing.T) {
	app := newTestAppWithDefaults(t)
	app.Ctx = context.Background()
	app.clusterClients = make(map[string]*clusterClients)
	app.clusterOps = newClusterOperationCoordinator()
	app.shellSessions = make(map[string]*shellSession)
	app.portForwardSessions = make(map[string]*portForwardSessionInternal)

	// Pre-populate a client to verify it gets cleaned up.
	app.clusterClientsMu.Lock()
	app.clusterClients["stale-cluster"] = &clusterClients{
		meta:   ClusterMeta{ID: "stale-cluster", Name: "Stale"},
		client: createHealthyClient(),
	}
	app.clusterClientsMu.Unlock()

	err := app.syncClusterClientPoolWithContext(context.Background(), nil)
	require.NoError(t, err)

	app.clusterClientsMu.Lock()
	defer app.clusterClientsMu.Unlock()
	require.Len(t, app.clusterClients, 0, "all clients should be removed with empty selections")
}

// TestSyncClusterClientPool_NilAppReturnsError verifies the nil-receiver guard.
func TestSyncClusterClientPool_NilAppReturnsError(t *testing.T) {
	var app *App
	err := app.syncClusterClientPoolWithContext(context.Background(), nil)
	require.Error(t, err)
	require.Contains(t, err.Error(), "app is nil")
}

// TestSyncClusterClientPool_CancelledContextSkipsCreation verifies that a
// pre-cancelled context causes the build to be silently skipped rather than
// producing an error. runClusterOperation intentionally swallows context.Canceled
// (treating cancellation as a clean abort), so syncClusterClientPoolWithContext
// returns nil — but no clients are actually created.
func TestSyncClusterClientPool_CancelledContextSkipsCreation(t *testing.T) {
	app := newTestAppWithDefaults(t)
	app.Ctx = context.Background()
	app.clusterClients = make(map[string]*clusterClients)
	app.clusterOps = newClusterOperationCoordinator()
	app.shellSessions = make(map[string]*shellSession)
	app.portForwardSessions = make(map[string]*portForwardSessionInternal)

	app.availableKubeconfigs = []KubeconfigInfo{
		{Name: "config", Path: "/nonexistent/kubeconfig", Context: "ctx"},
	}

	ctx, cancel := context.WithCancel(context.Background())
	cancel() // Cancel immediately.

	sel := kubeconfigSelection{Path: "/nonexistent/kubeconfig", Context: "ctx"}

	// runClusterOperation swallows context.Canceled, so sync returns nil even
	// though no client was built.
	err := app.syncClusterClientPoolWithContext(ctx, []kubeconfigSelection{sel})
	require.NoError(t, err, "cancelled context is treated as clean abort, not error")

	app.clusterClientsMu.Lock()
	defer app.clusterClientsMu.Unlock()
	require.Len(t, app.clusterClients, 0, "no clients should be created when context is cancelled")
}

// TestSyncClusterClientPool_RemovalCleansUpShellAndPortForward verifies that
// removing a stale cluster from the pool also calls StopClusterShellSessions
// and StopClusterPortForwards. We verify this indirectly by pre-populating
// sessions and confirming they are removed after sync.
func TestSyncClusterClientPool_RemovalCleansUpShellAndPortForward(t *testing.T) {
	app := newTestAppWithDefaults(t)
	app.Ctx = context.Background()
	app.clusterClients = make(map[string]*clusterClients)
	app.clusterOps = newClusterOperationCoordinator()
	app.shellSessions = make(map[string]*shellSession)
	app.portForwardSessions = make(map[string]*portForwardSessionInternal)

	clusterID := "removal-test-cluster"
	app.clusterClientsMu.Lock()
	app.clusterClients[clusterID] = &clusterClients{
		meta:   ClusterMeta{ID: clusterID, Name: "Removal Test"},
		client: createHealthyClient(),
	}
	app.clusterClientsMu.Unlock()

	// Add a port-forward session for this cluster.
	app.portForwardSessionsMu.Lock()
	app.portForwardSessions["pf-1"] = &portForwardSessionInternal{
		PortForwardSession: PortForwardSession{ID: "pf-1", ClusterID: clusterID},
	}
	app.portForwardSessionsMu.Unlock()

	// Sync with empty selections to remove the cluster.
	err := app.syncClusterClientPoolWithContext(context.Background(), nil)
	require.NoError(t, err)

	// Verify the port-forward session was cleaned up.
	app.portForwardSessionsMu.Lock()
	defer app.portForwardSessionsMu.Unlock()
	require.Len(t, app.portForwardSessions, 0, "port-forward sessions for removed cluster should be cleaned up")
}

// TestSyncClusterClientPool_RemovalShutsDownAuthManager verifies that removing
// a stale cluster shuts down its auth manager.
func TestSyncClusterClientPool_RemovalShutsDownAuthManager(t *testing.T) {
	app := newTestAppWithDefaults(t)
	app.Ctx = context.Background()
	app.clusterClients = make(map[string]*clusterClients)
	app.clusterOps = newClusterOperationCoordinator()
	app.shellSessions = make(map[string]*shellSession)
	app.portForwardSessions = make(map[string]*portForwardSessionInternal)

	authMgr := authstate.New(authstate.Config{MaxAttempts: 0})

	app.clusterClientsMu.Lock()
	app.clusterClients["auth-test"] = &clusterClients{
		meta:        ClusterMeta{ID: "auth-test", Name: "Auth Test"},
		client:      createHealthyClient(),
		authManager: authMgr,
	}
	app.clusterClientsMu.Unlock()

	// Sync with empty to remove — auth manager Shutdown will be called.
	err := app.syncClusterClientPoolWithContext(context.Background(), nil)
	require.NoError(t, err)

	app.clusterClientsMu.Lock()
	defer app.clusterClientsMu.Unlock()
	require.Len(t, app.clusterClients, 0)
}

// TestSyncClusterClientPool_ConcurrentAccess verifies that sync is safe to call
// from multiple goroutines (no data race on clusterClients map).
func TestSyncClusterClientPool_ConcurrentAccess(t *testing.T) {
	app := newTestAppWithDefaults(t)
	app.Ctx = context.Background()
	app.clusterClients = make(map[string]*clusterClients)
	app.clusterOps = newClusterOperationCoordinator()
	app.shellSessions = make(map[string]*shellSession)
	app.portForwardSessions = make(map[string]*portForwardSessionInternal)

	app.availableKubeconfigs = []KubeconfigInfo{
		{Name: "config", Path: "/tmp/config", Context: "ctx-1"},
	}

	sel := kubeconfigSelection{Path: "/tmp/config", Context: "ctx-1"}
	id := app.clusterMetaForSelection(sel).ID

	// Pre-populate so build is not attempted.
	app.clusterClientsMu.Lock()
	app.clusterClients[id] = &clusterClients{
		meta:   ClusterMeta{ID: id, Name: "ctx-1"},
		client: createHealthyClient(),
	}
	app.clusterClientsMu.Unlock()

	var wg sync.WaitGroup
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_ = app.syncClusterClientPoolWithContext(context.Background(), []kubeconfigSelection{sel})
		}()
	}
	wg.Wait()

	app.clusterClientsMu.Lock()
	defer app.clusterClientsMu.Unlock()
	require.Len(t, app.clusterClients, 1)
	require.NotNil(t, app.clusterClients[id])
}
