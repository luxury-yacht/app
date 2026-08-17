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
	app := newWorkspaceCoordinatorTestFixture(t)
	assertAdvance := func(mutate func()) {
		t.Helper()
		before := app.ClusterWorkspace.clusterWorkspaceRevision.Load()
		mutate()
		require.Greater(t, app.ClusterWorkspace.clusterWorkspaceRevision.Load(), before)
	}

	assertAdvance(func() {
		app.Workspace.kubeconfigsMu.Lock()
		app.Workspace.setSelectedKubeconfigsLocked([]string{"/tmp/config:prod"})
		app.Workspace.kubeconfigsMu.Unlock()
	})
	assertAdvance(func() {
		app.Refresh.governorMu.Lock()
		app.Refresh.setGovernorVisibleLocked("cluster-a")
		app.Refresh.governorMu.Unlock()
	})
	assertAdvance(func() {
		app.ClusterRuntime.clusterClientsMu.Lock()
		app.ClusterRuntime.setClusterClientLocked("cluster-a", &clusterClients{meta: ClusterMeta{ID: "cluster-a"}})
		app.ClusterRuntime.clusterClientsMu.Unlock()
	})
	assertAdvance(func() {
		app.ClusterWorkspace.setClusterHealth("cluster-a", ClusterHealthHealthy)
	})
	assertAdvance(func() {
		app.ClusterWorkspace.incrementClusterScopeRevision("cluster-a")
	})
	assertAdvance(func() {
		lifecycle := newClusterLifecycle(nil)
		lifecycle.setSnapshotChangeObserver(app.ClusterWorkspace.markClusterWorkspaceChanged)
		lifecycle.SetState("cluster-a", ClusterStateReady)
	})
}

func TestGetClusterWorkspaceStateWaitsForSelectionMutation(t *testing.T) {
	app := newWorkspaceCoordinatorTestFixture(t)
	app.Workspace.selectionMutationMu.Lock()
	started := make(chan struct{})
	result := make(chan ClusterWorkspaceState, 1)
	go func() {
		close(started)
		result <- app.Workspace.GetClusterWorkspaceState()
	}()
	<-started

	select {
	case <-result:
		app.Workspace.selectionMutationMu.Unlock()
		t.Fatal("workspace snapshot escaped an active selection mutation")
	case <-time.After(20 * time.Millisecond):
	}

	app.Workspace.selectionMutationMu.Unlock()
	select {
	case <-result:
	case <-time.After(time.Second):
		t.Fatal("workspace snapshot did not resume after the selection mutation")
	}
}

func TestClusterWorkspaceStateCombinesClusterFacts(t *testing.T) {
	app := newWorkspaceCoordinatorTestFixture(t)
	app.Workspace.selectedKubeconfigs = []string{"/tmp/config:prod"}
	app.Refresh.governorVisible = "cluster-a"
	app.ClusterRuntime.clusterLifecycle = newClusterLifecycle(nil)
	app.ClusterRuntime.clusterLifecycle.SetState("cluster-a", ClusterStateReady)
	app.ClusterWorkspace.setClusterHealth("cluster-a", ClusterHealthHealthy)
	app.ClusterWorkspace.incrementClusterScopeRevision("cluster-a")

	authManager := authstate.New(authstate.Config{MaxAttempts: 0})
	authManager.ReportFailure("token expired")
	app.ClusterRuntime.clusterClients["cluster-a"] = &clusterClients{
		meta:        ClusterMeta{ID: "cluster-a", Name: "Production"},
		authManager: authManager,
	}

	state := app.Workspace.GetClusterWorkspaceState()
	require.Equal(t, []string{"/tmp/config:prod"}, state.SelectedKubeconfigs)
	require.Equal(t, "cluster-a", state.VisibleClusterID)
	require.Equal(t, ClusterStateReady, state.Clusters["cluster-a"].Lifecycle)
	require.Equal(t, "invalid", state.Clusters["cluster-a"].Auth.State)
	require.Equal(t, ClusterHealthHealthy, state.Clusters["cluster-a"].Health)
	require.Equal(t, uint64(1), state.Clusters["cluster-a"].ScopeRevision)
}

func TestClusterWorkspaceStateProjectsVisibleClusterPerPeerWindow(t *testing.T) {
	app := newWorkspaceCoordinatorTestFixture(t)
	app.Refresh.governorMu.Lock()
	app.Refresh.governorWindows["workspace-1"] = "cluster-a"
	app.Refresh.governorWindows["workspace-2"] = "cluster-b"
	app.Refresh.governorMu.Unlock()

	require.Equal(t, "cluster-a", app.Workspace.GetClusterWorkspaceStateForWindow("workspace-1").VisibleClusterID)
	require.Equal(t, "cluster-b", app.Workspace.GetClusterWorkspaceStateForWindow("workspace-2").VisibleClusterID)

	app.Workspace.ReleaseWorkspaceWindow("workspace-1")
	require.Empty(t, app.Workspace.GetClusterWorkspaceStateForWindow("workspace-1").VisibleClusterID)
	require.Equal(t, "cluster-b", app.Workspace.GetClusterWorkspaceStateForWindow("workspace-2").VisibleClusterID)
}

func TestApplyClusterWorkspaceRecordsWindowIdentity(t *testing.T) {
	app := newWorkspaceCoordinatorTestFixture(t)

	first := app.Workspace.ApplyClusterWorkspace(ClusterWorkspaceCommand{
		WindowID:         "workspace-1",
		VisibleClusterID: "cluster-a",
	})
	second := app.Workspace.ApplyClusterWorkspace(ClusterWorkspaceCommand{
		WindowID:         "workspace-2",
		VisibleClusterID: "cluster-b",
	})

	require.Empty(t, first.Error)
	require.Empty(t, second.Error)
	require.Equal(t, "cluster-a", app.Workspace.GetClusterWorkspaceStateForWindow("workspace-1").VisibleClusterID)
	require.Equal(t, "cluster-b", app.Workspace.GetClusterWorkspaceStateForWindow("workspace-2").VisibleClusterID)
	app.Refresh.governorMu.Lock()
	require.Equal(t, map[string]string{
		"workspace-1": "cluster-a",
		"workspace-2": "cluster-b",
	}, app.Refresh.governorWindows)
	require.Equal(t, map[string]bool{"cluster-a": true, "cluster-b": true}, app.Refresh.visibleClustersLocked())
	app.Refresh.governorMu.Unlock()
}

func TestApplyClusterWorkspaceKeepsClusterUntilEveryWindowClosesItsTab(t *testing.T) {
	setTestConfigEnv(t)
	app := newWorkspaceCoordinatorTestFixture(t)
	selection := "/tmp/config:prod"
	app.Workspace.kubeconfigsMu.Lock()
	app.Workspace.setSelectedKubeconfigsLocked([]string{selection})
	app.Workspace.kubeconfigsMu.Unlock()
	app.ClusterRuntime.clusterClientsMu.Lock()
	app.ClusterRuntime.clusterClients["cluster-a"] = &clusterClients{meta: ClusterMeta{ID: "cluster-a", Name: "Production"}}
	app.ClusterRuntime.clusterClientsMu.Unlock()

	require.Equal(t, []string{selection}, app.Workspace.GetClusterWorkspaceStateForWindow("workspace-1").SelectedKubeconfigs)
	require.Equal(t, []string{selection}, app.Workspace.GetClusterWorkspaceStateForWindow("workspace-2").SelectedKubeconfigs)

	firstClose := app.Workspace.ApplyClusterWorkspace(ClusterWorkspaceCommand{
		WindowID:                  "workspace-1",
		UpdateSelectedKubeconfigs: true,
	})
	require.Empty(t, firstClose.Error)
	require.Empty(t, firstClose.State.SelectedKubeconfigs)
	require.Equal(t, []string{selection}, app.Workspace.GetSelectedKubeconfigs())
	require.Equal(t, []string{selection}, app.Workspace.GetClusterWorkspaceStateForWindow("workspace-2").SelectedKubeconfigs)
	app.ClusterRuntime.clusterClientsMu.Lock()
	require.Contains(t, app.ClusterRuntime.clusterClients, "cluster-a")
	app.ClusterRuntime.clusterClientsMu.Unlock()

	lastClose := app.Workspace.ApplyClusterWorkspace(ClusterWorkspaceCommand{
		WindowID:                  "workspace-2",
		UpdateSelectedKubeconfigs: true,
	})
	require.Empty(t, lastClose.Error)
	require.Empty(t, app.Workspace.GetSelectedKubeconfigs())
	app.ClusterRuntime.clusterClientsMu.Lock()
	require.NotContains(t, app.ClusterRuntime.clusterClients, "cluster-a")
	app.ClusterRuntime.clusterClientsMu.Unlock()
}

func TestReleaseWorkspaceWindowDropsOnlyThatWindowsTabOwnership(t *testing.T) {
	setTestConfigEnv(t)
	app := newWorkspaceCoordinatorTestFixture(t)
	selection := "/tmp/config:prod"
	app.Workspace.kubeconfigsMu.Lock()
	app.Workspace.setSelectedKubeconfigsLocked([]string{selection})
	app.Workspace.kubeconfigsMu.Unlock()
	app.Workspace.GetClusterWorkspaceStateForWindow("workspace-1")
	app.Workspace.GetClusterWorkspaceStateForWindow("workspace-2")

	app.Workspace.ReleaseWorkspaceWindow("workspace-1")

	require.Equal(t, []string{selection}, app.Workspace.GetSelectedKubeconfigs())
	require.Equal(t, []string{selection}, app.Workspace.GetClusterWorkspaceStateForWindow("workspace-2").SelectedKubeconfigs)
	app.Workspace.selectionMutationMu.Lock()
	require.NotContains(t, app.Workspace.workspaceSelections, "workspace-1")
	app.Workspace.selectionMutationMu.Unlock()

	app.Workspace.ReleaseWorkspaceWindow("workspace-2")

	require.Empty(t, app.Workspace.GetSelectedKubeconfigs())
}

func TestConcurrentPeerWorkspaceCommandsPreserveEachWindowsLatestTabs(t *testing.T) {
	setTestConfigEnv(t)
	app := newWorkspaceCoordinatorTestFixture(t)
	selection := "/tmp/config:prod"
	app.Workspace.kubeconfigsMu.Lock()
	app.Workspace.setSelectedKubeconfigsLocked([]string{selection})
	app.Workspace.kubeconfigsMu.Unlock()
	app.Workspace.GetClusterWorkspaceStateForWindow("workspace-1")
	app.Workspace.GetClusterWorkspaceStateForWindow("workspace-2")

	app.Workspace.selectionMutationMu.Lock()
	firstResult := make(chan ClusterWorkspaceResult, 1)
	go func() {
		firstResult <- app.Workspace.ApplyClusterWorkspace(ClusterWorkspaceCommand{
			WindowID:                  "workspace-1",
			UpdateSelectedKubeconfigs: true,
		})
	}()
	require.Eventually(t, func() bool {
		app.Workspace.selectionMutationDrainMu.Lock()
		defer app.Workspace.selectionMutationDrainMu.Unlock()
		return app.Workspace.selectionMutationPending == 1
	}, time.Second, time.Millisecond)

	secondResult := make(chan ClusterWorkspaceResult, 1)
	go func() {
		secondResult <- app.Workspace.ApplyClusterWorkspace(ClusterWorkspaceCommand{
			WindowID:         "workspace-2",
			VisibleClusterID: "cluster-a",
		})
	}()
	require.Eventually(t, func() bool {
		app.Workspace.selectionMutationDrainMu.Lock()
		defer app.Workspace.selectionMutationDrainMu.Unlock()
		return app.Workspace.selectionMutationPending == 2
	}, time.Second, time.Millisecond)
	app.Workspace.selectionMutationMu.Unlock()

	requireWorkspaceResult(t, firstResult)
	requireWorkspaceResult(t, secondResult)
	require.Empty(t, app.Workspace.GetClusterWorkspaceStateForWindow("workspace-1").SelectedKubeconfigs)
	require.Equal(t, []string{selection}, app.Workspace.GetClusterWorkspaceStateForWindow("workspace-2").SelectedKubeconfigs)
	require.Equal(t, []string{selection}, app.Workspace.GetSelectedKubeconfigs())
}

func TestApplySelectionPruneRemovesSelectionFromEveryWorkspaceWindow(t *testing.T) {
	setTestConfigEnv(t)
	app := newWorkspaceCoordinatorTestFixture(t)
	selection := "/tmp/config:prod"
	app.Workspace.kubeconfigsMu.Lock()
	app.Workspace.setSelectedKubeconfigsLocked([]string{selection})
	app.Workspace.kubeconfigsMu.Unlock()
	app.Workspace.GetClusterWorkspaceStateForWindow("workspace-1")
	app.Workspace.GetClusterWorkspaceStateForWindow("workspace-2")

	app.Workspace.selectionMutationMu.Lock()
	app.Workspace.applySelectionPrune(nil, nil, nil, "test")
	app.Workspace.selectionMutationMu.Unlock()

	require.Empty(t, app.Workspace.GetSelectedKubeconfigs())
	require.Empty(t, app.Workspace.GetClusterWorkspaceStateForWindow("workspace-1").SelectedKubeconfigs)
	require.Empty(t, app.Workspace.GetClusterWorkspaceStateForWindow("workspace-2").SelectedKubeconfigs)
}

func TestClearSelectionRemovesTabsFromEveryWorkspaceWindow(t *testing.T) {
	setTestConfigEnv(t)
	app := newWorkspaceCoordinatorTestFixture(t)
	selection := "/tmp/config:prod"
	app.Workspace.kubeconfigsMu.Lock()
	app.Workspace.setSelectedKubeconfigsLocked([]string{selection})
	app.Workspace.kubeconfigsMu.Unlock()
	app.Workspace.GetClusterWorkspaceStateForWindow("workspace-1")
	app.Workspace.GetClusterWorkspaceStateForWindow("workspace-2")

	require.NoError(t, app.Workspace.SetSelectedKubeconfigs(nil))

	require.Empty(t, app.Workspace.GetSelectedKubeconfigs())
	require.Empty(t, app.Workspace.GetClusterWorkspaceStateForWindow("workspace-1").SelectedKubeconfigs)
	require.Empty(t, app.Workspace.GetClusterWorkspaceStateForWindow("workspace-2").SelectedKubeconfigs)
}

func TestStartupSelectionRestoreUpdatesAnAlreadyRegisteredWorkspaceWindow(t *testing.T) {
	app := newWorkspaceCoordinatorTestFixture(t)
	configPath := createTempKubeconfig(t, t.TempDir(), "config", "prod")
	selection := kubeconfigSelection{Path: configPath, Context: "prod"}.String()
	app.ClusterRuntime.availableKubeconfigs = []KubeconfigInfo{{Path: configPath, Context: "prod"}}
	app.Preferences.appSettings = getDefaultAppSettings()
	app.Preferences.appSettings.SelectedKubeconfigs = []string{selection}
	require.Empty(t, app.Workspace.GetClusterWorkspaceStateForWindow("workspace-1").SelectedKubeconfigs)

	app.Workspace.selectionMutationMu.Lock()
	app.Workspace.restoreKubeconfigSelection()
	app.Workspace.selectionMutationMu.Unlock()

	require.Equal(t, []string{selection}, app.Workspace.GetSelectedKubeconfigs())
	require.Equal(t, []string{selection}, app.Workspace.GetClusterWorkspaceStateForWindow("workspace-1").SelectedKubeconfigs)
}

func TestClosingAWindowsLastTabClearsItsForegroundDemand(t *testing.T) {
	setTestConfigEnv(t)
	app := newWorkspaceCoordinatorTestFixture(t)
	selection := "/tmp/config:prod"
	app.Workspace.kubeconfigsMu.Lock()
	app.Workspace.setSelectedKubeconfigsLocked([]string{selection})
	app.Workspace.kubeconfigsMu.Unlock()
	app.Workspace.GetClusterWorkspaceStateForWindow("workspace-1")
	app.Refresh.SetWindowVisibleCluster("workspace-1", "cluster-a")

	result := app.Workspace.ApplyClusterWorkspace(ClusterWorkspaceCommand{
		WindowID:                  "workspace-1",
		UpdateSelectedKubeconfigs: true,
	})

	require.Empty(t, result.Error)
	require.Empty(t, result.State.VisibleClusterID)
	app.Refresh.governorMu.Lock()
	require.NotContains(t, app.Refresh.governorWindows, "workspace-1")
	app.Refresh.governorMu.Unlock()
}

func TestClearKubeconfigSelectionRemovesClusterWorkspaceState(t *testing.T) {
	app := newWorkspaceCoordinatorTestFixture(t)
	app.ClusterRuntime.clusterLifecycle = newClusterLifecycle(nil)
	app.ClusterRuntime.clusterLifecycle.SetState("cluster-a", ClusterStateReady)
	app.ClusterWorkspace.setClusterHealth("cluster-a", ClusterHealthDegraded)
	app.ClusterWorkspace.incrementClusterScopeRevision("cluster-a")
	app.ClusterRuntime.clusterClients["cluster-a"] = &clusterClients{meta: ClusterMeta{ID: "cluster-a", Name: "Production"}}

	require.NoError(t, app.Workspace.clearKubeconfigSelection())

	state := app.Workspace.GetClusterWorkspaceState()
	require.NotContains(t, state.Clusters, "cluster-a")
	require.Empty(t, app.ClusterRuntime.clusterLifecycle.GetAllStates())

	app.ClusterRuntime.clusterClients["cluster-a"] = &clusterClients{meta: ClusterMeta{ID: "cluster-a", Name: "Production"}}
	app.ClusterRuntime.clusterLifecycle.SetState("cluster-a", ClusterStateConnected)
	readded := app.Workspace.GetClusterWorkspaceState().Clusters["cluster-a"]
	require.Equal(t, ClusterHealthUnknown, readded.Health)
	require.Zero(t, readded.ScopeRevision)
}

func TestApplySelectionPruneRemovesClusterWorkspaceState(t *testing.T) {
	app := newWorkspaceCoordinatorTestFixture(t)
	app.ClusterRuntime.clusterLifecycle = newClusterLifecycle(nil)
	app.ClusterRuntime.clusterLifecycle.SetState("cluster-a", ClusterStateReady)
	app.ClusterWorkspace.setClusterHealth("cluster-a", ClusterHealthHealthy)
	app.ClusterWorkspace.incrementClusterScopeRevision("cluster-a")
	app.ClusterRuntime.clusterClients["cluster-a"] = &clusterClients{meta: ClusterMeta{ID: "cluster-a", Name: "Production"}}
	app.ClusterRuntime.clusterLifecycle.SetState("cluster-b", ClusterStateReady)
	app.ClusterWorkspace.setClusterHealth("cluster-b", ClusterHealthDegraded)
	app.ClusterWorkspace.incrementClusterScopeRevision("cluster-b")
	app.ClusterRuntime.clusterClients["cluster-b"] = &clusterClients{meta: ClusterMeta{ID: "cluster-b", Name: "Staging"}}

	app.Workspace.applySelectionPrune(nil, nil, []string{"cluster-a"}, "test")

	state := app.Workspace.GetClusterWorkspaceState()
	require.NotContains(t, state.Clusters, "cluster-a")
	require.Equal(t, ClusterStateReady, state.Clusters["cluster-b"].Lifecycle)
	require.Equal(t, ClusterHealthDegraded, state.Clusters["cluster-b"].Health)
	require.Equal(t, uint64(1), state.Clusters["cluster-b"].ScopeRevision)
	require.Equal(t, map[string]ClusterLifecycleState{"cluster-b": ClusterStateReady}, app.ClusterRuntime.clusterLifecycle.GetAllStates())
}

func TestApplyClusterWorkspaceReturnsAuthoritativeActivationState(t *testing.T) {
	app := newWorkspaceCoordinatorTestFixture(t)
	app.ClusterRuntime.clusterClients["cluster-a"] = &clusterClients{meta: ClusterMeta{ID: "cluster-a", Name: "Production"}}
	app.ClusterRuntime.clusterLifecycle = newClusterLifecycle(nil)
	app.ClusterRuntime.clusterLifecycle.SetState("cluster-a", ClusterStateReady)
	app.Refresh.governorApplied["cluster-a"] = system.TierForeground
	app.Refresh.governorPlanned["cluster-a"] = system.TierForeground

	result := app.Workspace.ApplyClusterWorkspace(ClusterWorkspaceCommand{VisibleClusterID: "cluster-a"})
	require.Empty(t, result.Error)
	require.Equal(t, "cluster-a", result.State.VisibleClusterID)
	require.Equal(t, ClusterStateReady, result.State.Clusters["cluster-a"].Lifecycle)
}

func TestApplyClusterWorkspaceSupersedesOlderQueuedActivation(t *testing.T) {
	app := newWorkspaceCoordinatorTestFixture(t)
	app.Refresh.governorApplied["cluster-a"] = system.TierForeground
	app.Refresh.governorPlanned["cluster-a"] = system.TierForeground
	app.Refresh.governorApplied["cluster-b"] = system.TierForeground
	app.Refresh.governorPlanned["cluster-b"] = system.TierForeground

	app.Workspace.selectionMutationMu.Lock()
	olderResult := make(chan ClusterWorkspaceResult, 1)
	go func() {
		olderResult <- app.Workspace.ApplyClusterWorkspace(ClusterWorkspaceCommand{VisibleClusterID: "cluster-a"})
	}()

	require.Eventually(t, func() bool {
		app.Workspace.selectionMutationDrainMu.Lock()
		defer app.Workspace.selectionMutationDrainMu.Unlock()
		return app.Workspace.selectionMutationPending == 1
	}, time.Second, time.Millisecond)
	newerResult := make(chan ClusterWorkspaceResult, 1)
	go func() {
		newerResult <- app.Workspace.ApplyClusterWorkspace(ClusterWorkspaceCommand{VisibleClusterID: "cluster-b"})
	}()
	require.Eventually(t, func() bool {
		app.Workspace.selectionMutationDrainMu.Lock()
		defer app.Workspace.selectionMutationDrainMu.Unlock()
		return app.Workspace.selectionMutationPending == 2
	}, time.Second, time.Millisecond)

	select {
	case <-olderResult:
		app.Workspace.selectionMutationMu.Unlock()
		t.Fatal("older workspace command completed outside the selection mutation boundary")
	case <-newerResult:
		app.Workspace.selectionMutationMu.Unlock()
		t.Fatal("newer workspace command completed outside the selection mutation boundary")
	default:
	}

	app.Workspace.selectionMutationMu.Unlock()
	requireWorkspaceResult(t, olderResult)
	requireWorkspaceResult(t, newerResult)
	require.Equal(t, "cluster-b", app.Workspace.GetClusterWorkspaceState().VisibleClusterID)
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
