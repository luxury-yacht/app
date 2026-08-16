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
	app := NewApp(nil)
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
	app := NewApp(nil)
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
	app := NewApp(nil)
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

func TestClusterWorkspaceStateProjectsVisibleClusterPerPeerWindow(t *testing.T) {
	app := NewApp(nil)
	app.governorMu.Lock()
	app.governorWindows["workspace-1"] = "cluster-a"
	app.governorWindows["workspace-2"] = "cluster-b"
	app.governorMu.Unlock()

	require.Equal(t, "cluster-a", app.GetClusterWorkspaceStateForWindow("workspace-1").VisibleClusterID)
	require.Equal(t, "cluster-b", app.GetClusterWorkspaceStateForWindow("workspace-2").VisibleClusterID)

	app.ReleaseWorkspaceWindow("workspace-1")
	require.Empty(t, app.GetClusterWorkspaceStateForWindow("workspace-1").VisibleClusterID)
	require.Equal(t, "cluster-b", app.GetClusterWorkspaceStateForWindow("workspace-2").VisibleClusterID)
}

func TestApplyClusterWorkspaceRecordsWindowIdentity(t *testing.T) {
	app := NewApp(nil)

	first := app.ApplyClusterWorkspace(ClusterWorkspaceCommand{
		WindowID:         "workspace-1",
		VisibleClusterID: "cluster-a",
	})
	second := app.ApplyClusterWorkspace(ClusterWorkspaceCommand{
		WindowID:         "workspace-2",
		VisibleClusterID: "cluster-b",
	})

	require.Empty(t, first.Error)
	require.Empty(t, second.Error)
	require.Equal(t, "cluster-a", app.GetClusterWorkspaceStateForWindow("workspace-1").VisibleClusterID)
	require.Equal(t, "cluster-b", app.GetClusterWorkspaceStateForWindow("workspace-2").VisibleClusterID)
	app.governorMu.Lock()
	require.Equal(t, map[string]string{
		"workspace-1": "cluster-a",
		"workspace-2": "cluster-b",
	}, app.governorWindows)
	require.Equal(t, map[string]bool{"cluster-a": true, "cluster-b": true}, app.visibleClustersLocked())
	app.governorMu.Unlock()
}

func TestApplyClusterWorkspaceKeepsClusterUntilEveryWindowClosesItsTab(t *testing.T) {
	setTestConfigEnv(t)
	app := NewApp(nil)
	selection := "/tmp/config:prod"
	app.kubeconfigsMu.Lock()
	app.setSelectedKubeconfigsLocked([]string{selection})
	app.kubeconfigsMu.Unlock()
	app.clusterClientsMu.Lock()
	app.clusterClients["cluster-a"] = &clusterClients{meta: ClusterMeta{ID: "cluster-a", Name: "Production"}}
	app.clusterClientsMu.Unlock()

	require.Equal(t, []string{selection}, app.GetClusterWorkspaceStateForWindow("workspace-1").SelectedKubeconfigs)
	require.Equal(t, []string{selection}, app.GetClusterWorkspaceStateForWindow("workspace-2").SelectedKubeconfigs)

	firstClose := app.ApplyClusterWorkspace(ClusterWorkspaceCommand{
		WindowID:                  "workspace-1",
		UpdateSelectedKubeconfigs: true,
	})
	require.Empty(t, firstClose.Error)
	require.Empty(t, firstClose.State.SelectedKubeconfigs)
	require.Equal(t, []string{selection}, app.GetSelectedKubeconfigs())
	require.Equal(t, []string{selection}, app.GetClusterWorkspaceStateForWindow("workspace-2").SelectedKubeconfigs)
	app.clusterClientsMu.Lock()
	require.Contains(t, app.clusterClients, "cluster-a")
	app.clusterClientsMu.Unlock()

	lastClose := app.ApplyClusterWorkspace(ClusterWorkspaceCommand{
		WindowID:                  "workspace-2",
		UpdateSelectedKubeconfigs: true,
	})
	require.Empty(t, lastClose.Error)
	require.Empty(t, app.GetSelectedKubeconfigs())
	app.clusterClientsMu.Lock()
	require.NotContains(t, app.clusterClients, "cluster-a")
	app.clusterClientsMu.Unlock()
}

func TestReleaseWorkspaceWindowDropsOnlyThatWindowsTabOwnership(t *testing.T) {
	setTestConfigEnv(t)
	app := NewApp(nil)
	selection := "/tmp/config:prod"
	app.kubeconfigsMu.Lock()
	app.setSelectedKubeconfigsLocked([]string{selection})
	app.kubeconfigsMu.Unlock()
	app.GetClusterWorkspaceStateForWindow("workspace-1")
	app.GetClusterWorkspaceStateForWindow("workspace-2")

	app.ReleaseWorkspaceWindow("workspace-1")

	require.Equal(t, []string{selection}, app.GetSelectedKubeconfigs())
	require.Equal(t, []string{selection}, app.GetClusterWorkspaceStateForWindow("workspace-2").SelectedKubeconfigs)
	app.selectionMutationMu.Lock()
	require.NotContains(t, app.workspaceSelections, "workspace-1")
	app.selectionMutationMu.Unlock()

	app.ReleaseWorkspaceWindow("workspace-2")

	require.Empty(t, app.GetSelectedKubeconfigs())
}

func TestConcurrentPeerWorkspaceCommandsPreserveEachWindowsLatestTabs(t *testing.T) {
	setTestConfigEnv(t)
	app := NewApp(nil)
	selection := "/tmp/config:prod"
	app.kubeconfigsMu.Lock()
	app.setSelectedKubeconfigsLocked([]string{selection})
	app.kubeconfigsMu.Unlock()
	app.GetClusterWorkspaceStateForWindow("workspace-1")
	app.GetClusterWorkspaceStateForWindow("workspace-2")

	app.selectionMutationMu.Lock()
	firstResult := make(chan ClusterWorkspaceResult, 1)
	go func() {
		firstResult <- app.ApplyClusterWorkspace(ClusterWorkspaceCommand{
			WindowID:                  "workspace-1",
			UpdateSelectedKubeconfigs: true,
		})
	}()
	require.Eventually(t, func() bool {
		app.selectionMutationDrainMu.Lock()
		defer app.selectionMutationDrainMu.Unlock()
		return app.selectionMutationPending == 1
	}, time.Second, time.Millisecond)

	secondResult := make(chan ClusterWorkspaceResult, 1)
	go func() {
		secondResult <- app.ApplyClusterWorkspace(ClusterWorkspaceCommand{
			WindowID:         "workspace-2",
			VisibleClusterID: "cluster-a",
		})
	}()
	require.Eventually(t, func() bool {
		app.selectionMutationDrainMu.Lock()
		defer app.selectionMutationDrainMu.Unlock()
		return app.selectionMutationPending == 2
	}, time.Second, time.Millisecond)
	app.selectionMutationMu.Unlock()

	requireWorkspaceResult(t, firstResult)
	requireWorkspaceResult(t, secondResult)
	require.Empty(t, app.GetClusterWorkspaceStateForWindow("workspace-1").SelectedKubeconfigs)
	require.Equal(t, []string{selection}, app.GetClusterWorkspaceStateForWindow("workspace-2").SelectedKubeconfigs)
	require.Equal(t, []string{selection}, app.GetSelectedKubeconfigs())
}

func TestApplySelectionPruneRemovesSelectionFromEveryWorkspaceWindow(t *testing.T) {
	setTestConfigEnv(t)
	app := NewApp(nil)
	selection := "/tmp/config:prod"
	app.kubeconfigsMu.Lock()
	app.setSelectedKubeconfigsLocked([]string{selection})
	app.kubeconfigsMu.Unlock()
	app.GetClusterWorkspaceStateForWindow("workspace-1")
	app.GetClusterWorkspaceStateForWindow("workspace-2")

	app.selectionMutationMu.Lock()
	app.applySelectionPrune(nil, nil, nil, "test")
	app.selectionMutationMu.Unlock()

	require.Empty(t, app.GetSelectedKubeconfigs())
	require.Empty(t, app.GetClusterWorkspaceStateForWindow("workspace-1").SelectedKubeconfigs)
	require.Empty(t, app.GetClusterWorkspaceStateForWindow("workspace-2").SelectedKubeconfigs)
}

func TestClearSelectionRemovesTabsFromEveryWorkspaceWindow(t *testing.T) {
	setTestConfigEnv(t)
	app := NewApp(nil)
	selection := "/tmp/config:prod"
	app.kubeconfigsMu.Lock()
	app.setSelectedKubeconfigsLocked([]string{selection})
	app.kubeconfigsMu.Unlock()
	app.GetClusterWorkspaceStateForWindow("workspace-1")
	app.GetClusterWorkspaceStateForWindow("workspace-2")

	require.NoError(t, app.SetSelectedKubeconfigs(nil))

	require.Empty(t, app.GetSelectedKubeconfigs())
	require.Empty(t, app.GetClusterWorkspaceStateForWindow("workspace-1").SelectedKubeconfigs)
	require.Empty(t, app.GetClusterWorkspaceStateForWindow("workspace-2").SelectedKubeconfigs)
}

func TestStartupSelectionRestoreUpdatesAnAlreadyRegisteredWorkspaceWindow(t *testing.T) {
	app := NewApp(nil)
	configPath := createTempKubeconfig(t, t.TempDir(), "config", "prod")
	selection := kubeconfigSelection{Path: configPath, Context: "prod"}.String()
	app.availableKubeconfigs = []KubeconfigInfo{{Path: configPath, Context: "prod"}}
	app.preferences.appSettings = getDefaultAppSettings()
	app.preferences.appSettings.SelectedKubeconfigs = []string{selection}
	require.Empty(t, app.GetClusterWorkspaceStateForWindow("workspace-1").SelectedKubeconfigs)

	app.selectionMutationMu.Lock()
	app.restoreKubeconfigSelection()
	app.selectionMutationMu.Unlock()

	require.Equal(t, []string{selection}, app.GetSelectedKubeconfigs())
	require.Equal(t, []string{selection}, app.GetClusterWorkspaceStateForWindow("workspace-1").SelectedKubeconfigs)
}

func TestClosingAWindowsLastTabClearsItsForegroundDemand(t *testing.T) {
	setTestConfigEnv(t)
	app := NewApp(nil)
	selection := "/tmp/config:prod"
	app.kubeconfigsMu.Lock()
	app.setSelectedKubeconfigsLocked([]string{selection})
	app.kubeconfigsMu.Unlock()
	app.GetClusterWorkspaceStateForWindow("workspace-1")
	app.SetWindowVisibleCluster("workspace-1", "cluster-a")

	result := app.ApplyClusterWorkspace(ClusterWorkspaceCommand{
		WindowID:                  "workspace-1",
		UpdateSelectedKubeconfigs: true,
	})

	require.Empty(t, result.Error)
	require.Empty(t, result.State.VisibleClusterID)
	app.governorMu.Lock()
	require.NotContains(t, app.governorWindows, "workspace-1")
	app.governorMu.Unlock()
}

func TestClearKubeconfigSelectionRemovesClusterWorkspaceState(t *testing.T) {
	app := NewApp(nil)
	app.clusterLifecycle = newClusterLifecycle(nil)
	app.clusterLifecycle.SetState("cluster-a", ClusterStateReady)
	app.setClusterHealth("cluster-a", ClusterHealthDegraded)
	app.incrementClusterScopeRevision("cluster-a")
	app.clusterClients["cluster-a"] = &clusterClients{meta: ClusterMeta{ID: "cluster-a", Name: "Production"}}

	require.NoError(t, app.clearKubeconfigSelection())

	state := app.GetClusterWorkspaceState()
	require.NotContains(t, state.Clusters, "cluster-a")
	require.Empty(t, app.clusterLifecycle.GetAllStates())

	app.clusterClients["cluster-a"] = &clusterClients{meta: ClusterMeta{ID: "cluster-a", Name: "Production"}}
	app.clusterLifecycle.SetState("cluster-a", ClusterStateConnected)
	readded := app.GetClusterWorkspaceState().Clusters["cluster-a"]
	require.Equal(t, ClusterHealthUnknown, readded.Health)
	require.Zero(t, readded.ScopeRevision)
}

func TestApplySelectionPruneRemovesClusterWorkspaceState(t *testing.T) {
	app := NewApp(nil)
	app.clusterLifecycle = newClusterLifecycle(nil)
	app.clusterLifecycle.SetState("cluster-a", ClusterStateReady)
	app.setClusterHealth("cluster-a", ClusterHealthHealthy)
	app.incrementClusterScopeRevision("cluster-a")
	app.clusterClients["cluster-a"] = &clusterClients{meta: ClusterMeta{ID: "cluster-a", Name: "Production"}}
	app.clusterLifecycle.SetState("cluster-b", ClusterStateReady)
	app.setClusterHealth("cluster-b", ClusterHealthDegraded)
	app.incrementClusterScopeRevision("cluster-b")
	app.clusterClients["cluster-b"] = &clusterClients{meta: ClusterMeta{ID: "cluster-b", Name: "Staging"}}

	app.applySelectionPrune(nil, nil, []string{"cluster-a"}, "test")

	state := app.GetClusterWorkspaceState()
	require.NotContains(t, state.Clusters, "cluster-a")
	require.Equal(t, ClusterStateReady, state.Clusters["cluster-b"].Lifecycle)
	require.Equal(t, ClusterHealthDegraded, state.Clusters["cluster-b"].Health)
	require.Equal(t, uint64(1), state.Clusters["cluster-b"].ScopeRevision)
	require.Equal(t, map[string]ClusterLifecycleState{"cluster-b": ClusterStateReady}, app.clusterLifecycle.GetAllStates())
}

func TestApplyClusterWorkspaceReturnsAuthoritativeActivationState(t *testing.T) {
	app := NewApp(nil)
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
	app := NewApp(nil)
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
