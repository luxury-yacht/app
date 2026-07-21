package backend

import (
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/internal/authstate"
	"github.com/luxury-yacht/app/backend/refresh/system"
	"github.com/stretchr/testify/require"
)

func TestClusterWorkspaceStateCombinesClusterFacts(t *testing.T) {
	app := NewApp()
	app.selectedKubeconfigs = []string{"/tmp/config:prod"}
	app.governorVisible = "cluster-a"
	app.clusterLifecycle = newClusterLifecycle(nil)
	app.clusterLifecycle.SetState("cluster-a", ClusterStateReady)
	app.setClusterHealth("cluster-a", ClusterHealthHealthy)
	app.incrementClusterScopeRevision("cluster-a")

	authManager := authstate.New(authstate.Config{MaxAttempts: 0})
	authManager.ReportFailure("token expired")
	app.clusterClients["cluster-a"] = &clusterClients{
		meta:        ClusterMeta{ID: "cluster-a", Name: "Production"},
		authManager: authManager,
	}

	state := app.GetClusterWorkspaceState()
	require.Equal(t, []string{"/tmp/config:prod"}, state.SelectedKubeconfigs)
	require.Equal(t, "cluster-a", state.VisibleClusterID)
	require.Equal(t, ClusterStateReady, state.Clusters["cluster-a"].Lifecycle)
	require.Equal(t, "invalid", state.Clusters["cluster-a"].Auth.State)
	require.Equal(t, ClusterHealthHealthy, state.Clusters["cluster-a"].Health)
	require.Equal(t, uint64(1), state.Clusters["cluster-a"].ScopeRevision)
}

func TestApplyClusterWorkspaceReturnsAuthoritativeActivationState(t *testing.T) {
	app := NewApp()
	app.clusterClients["cluster-a"] = &clusterClients{meta: ClusterMeta{ID: "cluster-a", Name: "Production"}}
	app.clusterLifecycle = newClusterLifecycle(nil)
	app.clusterLifecycle.SetState("cluster-a", ClusterStateReady)
	app.governorApplied["cluster-a"] = system.TierForeground
	app.governorPlanned["cluster-a"] = system.TierForeground

	result := app.ApplyClusterWorkspace(ClusterWorkspaceCommand{VisibleClusterID: "cluster-a"})
	require.Empty(t, result.Error)
	require.Equal(t, "cluster-a", result.State.VisibleClusterID)
	require.Equal(t, ClusterStateReady, result.State.Clusters["cluster-a"].Lifecycle)
}

func TestApplyClusterWorkspaceSupersedesOlderQueuedActivation(t *testing.T) {
	app := NewApp()
	app.governorApplied["cluster-a"] = system.TierForeground
	app.governorPlanned["cluster-a"] = system.TierForeground
	app.governorApplied["cluster-b"] = system.TierForeground
	app.governorPlanned["cluster-b"] = system.TierForeground

	app.selectionMutationMu.Lock()
	olderResult := make(chan ClusterWorkspaceResult, 1)
	go func() {
		olderResult <- app.ApplyClusterWorkspace(ClusterWorkspaceCommand{VisibleClusterID: "cluster-a"})
	}()

	require.Eventually(t, func() bool {
		app.selectionMutationDrainMu.Lock()
		defer app.selectionMutationDrainMu.Unlock()
		return app.selectionMutationPending == 1
	}, time.Second, time.Millisecond)
	newerResult := make(chan ClusterWorkspaceResult, 1)
	go func() {
		newerResult <- app.ApplyClusterWorkspace(ClusterWorkspaceCommand{VisibleClusterID: "cluster-b"})
	}()
	require.Eventually(t, func() bool {
		app.selectionMutationDrainMu.Lock()
		defer app.selectionMutationDrainMu.Unlock()
		return app.selectionMutationPending == 2
	}, time.Second, time.Millisecond)

	select {
	case <-olderResult:
		app.selectionMutationMu.Unlock()
		t.Fatal("older workspace command completed outside the selection mutation boundary")
	case <-newerResult:
		app.selectionMutationMu.Unlock()
		t.Fatal("newer workspace command completed outside the selection mutation boundary")
	default:
	}

	app.selectionMutationMu.Unlock()
	requireWorkspaceResult(t, olderResult)
	requireWorkspaceResult(t, newerResult)
	require.Equal(t, "cluster-b", app.GetClusterWorkspaceState().VisibleClusterID)
}

func requireWorkspaceResult(t *testing.T, result <-chan ClusterWorkspaceResult) {
	t.Helper()
	select {
	case got := <-result:
		require.Empty(t, got.Error)
	case <-time.After(time.Second):
		t.Fatal("workspace command did not complete after releasing the selection mutation boundary")
	}
}
