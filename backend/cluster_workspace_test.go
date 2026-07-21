package backend

import (
	"sync/atomic"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/internal/authstate"
	"github.com/luxury-yacht/app/backend/refresh/system"
	"github.com/stretchr/testify/require"
)

func TestReadConsistentClusterWorkspaceStateRetriesChangedCapture(t *testing.T) {
	var revision atomic.Uint64
	attempts := 0

	state := readConsistentClusterWorkspaceState(revision.Load, func() ClusterWorkspaceState {
		attempts++
		if attempts == 1 {
			revision.Add(1)
			return ClusterWorkspaceState{VisibleClusterID: "stale"}
		}
		return ClusterWorkspaceState{VisibleClusterID: "current"}
	})

	require.Equal(t, "current", state.VisibleClusterID)
	require.Equal(t, 2, attempts)
}

func TestClusterWorkspaceSnapshotSourcesAdvanceRevision(t *testing.T) {
	app := NewApp()
	assertAdvance := func(mutate func()) {
		t.Helper()
		before := app.clusterWorkspaceRevision.Load()
		mutate()
		require.Greater(t, app.clusterWorkspaceRevision.Load(), before)
	}

	assertAdvance(func() {
		app.kubeconfigsMu.Lock()
		app.setSelectedKubeconfigsLocked([]string{"/tmp/config:prod"})
		app.kubeconfigsMu.Unlock()
	})
	assertAdvance(func() {
		app.governorMu.Lock()
		app.setGovernorVisibleLocked("cluster-a")
		app.governorMu.Unlock()
	})
	assertAdvance(func() {
		app.clusterClientsMu.Lock()
		app.setClusterClientLocked("cluster-a", &clusterClients{meta: ClusterMeta{ID: "cluster-a"}})
		app.clusterClientsMu.Unlock()
	})
	assertAdvance(func() {
		app.setClusterHealth("cluster-a", ClusterHealthHealthy)
	})
	assertAdvance(func() {
		app.incrementClusterScopeRevision("cluster-a")
	})
	assertAdvance(func() {
		lifecycle := newClusterLifecycle(nil)
		lifecycle.setSnapshotChangeObserver(app.markClusterWorkspaceChanged)
		lifecycle.SetState("cluster-a", ClusterStateReady)
	})
}

func TestGetClusterWorkspaceStateWaitsForSelectionMutation(t *testing.T) {
	app := NewApp()
	app.selectionMutationMu.Lock()
	started := make(chan struct{})
	result := make(chan ClusterWorkspaceState, 1)
	go func() {
		close(started)
		result <- app.GetClusterWorkspaceState()
	}()
	<-started

	select {
	case <-result:
		app.selectionMutationMu.Unlock()
		t.Fatal("workspace snapshot escaped an active selection mutation")
	case <-time.After(20 * time.Millisecond):
	}

	app.selectionMutationMu.Unlock()
	select {
	case <-result:
	case <-time.After(time.Second):
		t.Fatal("workspace snapshot did not resume after the selection mutation")
	}
}

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
