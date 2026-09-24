package backend

import (
	"github.com/luxury-yacht/app/internal/panelwindow"
	"github.com/stretchr/testify/require"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

type clusterCloseStopper func(string)

func (stop clusterCloseStopper) StopCluster(clusterID string) { stop(clusterID) }

func TestCloseClusterViewAcknowledgesCommittedSelectionBeforeRuntimeCleanup(t *testing.T) {
	setTestConfigEnv(t)
	app := newWorkspaceCoordinatorTestFixture(t)
	workspace := app.Workspace
	path := filepath.Join(t.TempDir(), "config")
	selection := path + ":prod"
	clusterID := "config:prod"
	workspace.selectedKubeconfigs = []string{selection}
	app.ClusterRuntime.availableKubeconfigs = []KubeconfigInfo{{Name: "config", Path: path, Context: "prod"}}
	app.ClusterRuntime.clusterClients = map[string]*clusterClients{
		clusterID: {meta: ClusterMeta{ID: clusterID}, kubeconfigPath: path, kubeconfigContext: "prod"},
	}
	workspace.GetClusterWorkspaceStateForWindow("app-a")
	require.NoError(t, app.Preferences.SaveSelectedKubeconfigs([]string{selection}))

	stopping := make(chan string, 1)
	resume := make(chan struct{})
	release := sync.OnceFunc(func() { close(resume) })
	workspace.operations = clusterCloseStopper(func(id string) {
		stopping <- id
		<-resume
	})
	closed := make(chan error, 1)
	go func() { closed <- workspace.CloseClusterView("app-a", clusterID) }()
	t.Cleanup(func() {
		release()
		require.True(t, workspace.waitForSelectionMutationIdle(time.Second))
	})
	select {
	case id := <-stopping:
		require.Equal(t, clusterID, id)
	case <-time.After(time.Second):
		t.Fatal("close never reached runtime cleanup")
	}
	select {
	case err := <-closed:
		require.NoError(t, err)
	case <-time.After(100 * time.Millisecond):
		t.Fatal("tab close acknowledgement waited for runtime cleanup")
	}
	require.Empty(t, workspace.GetClusterWorkspaceStateForWindow("app-a").SelectedKubeconfigs)
	require.Empty(t, workspace.GetSelectedKubeconfigs())
	reloaded := newWorkspaceCoordinatorTestFixture(t)
	_, err := reloaded.Preferences.EnsureLoadedForStartup()
	require.NoError(t, err)
	require.Empty(t, reloaded.Preferences.SelectedKubeconfigs())
	require.False(t, workspace.waitForSelectionMutationIdle(10*time.Millisecond), "shutdown must still wait for cleanup")
	reopened := make(chan ClusterWorkspaceResult, 1)
	go func() {
		reopened <- workspace.ApplyClusterWorkspace(ClusterWorkspaceCommand{
			WindowID: "app-a", UpdateSelectedKubeconfigs: true, SelectedKubeconfigs: []string{selection},
		})
	}()
	require.Eventually(t, func() bool {
		diagnostics, err := workspace.GetSelectionDiagnostics()
		return err == nil && diagnostics.ActiveQueueDepth == 2
	}, time.Second, time.Millisecond)
	require.Empty(t, workspace.WindowClusterIDs("app-a"), "reopen must not commit ahead of old cleanup")
	release()
	select {
	case result := <-reopened:
		// Reopen acknowledges membership before connection. A missing on-disk
		// kubeconfig must retain that admitted tab and report work failure separately.
		require.Empty(t, result.Error)
		require.Equal(t, []string{selection}, result.State.SelectedKubeconfigs)
	case <-time.After(time.Second):
		t.Fatal("reopen did not resume after cleanup")
	}
	require.True(t, workspace.waitForSelectionMutationIdle(time.Second))
	require.Equal(t, []string{"config:prod"}, workspace.WindowClusterIDs("app-a"))
	diagnostics, err := workspace.GetSelectionDiagnostics()
	require.NoError(t, err)
	require.NotEmpty(t, diagnostics.LastError)
}

func TestCloseClusterViewRetainsOtherClustersAndReportsCleanupFailureAfterAcceptance(t *testing.T) {
	setTestConfigEnv(t)
	app := newWorkspaceCoordinatorTestFixture(t)
	workspace := app.Workspace
	workspace.selectedKubeconfigs = []string{"/tmp/config:prod", "/tmp/config:stage"}
	app.ClusterRuntime.availableKubeconfigs = []KubeconfigInfo{
		{Name: "config", Path: "/tmp/config", Context: "prod"},
		{Name: "config", Path: "/tmp/config", Context: "stage"},
	}
	stageClient := &clusterClients{meta: ClusterMeta{ID: "config:stage"}, kubeconfigPath: "/tmp/config", kubeconfigContext: "stage"}
	app.ClusterRuntime.clusterClients = map[string]*clusterClients{
		"config:prod":  {meta: ClusterMeta{ID: "config:prod"}, kubeconfigPath: "/tmp/config", kubeconfigContext: "prod"},
		"config:stage": stageClient,
	}
	workspace.GetClusterWorkspaceStateForWindow("app-a")
	stopping := make(chan string, 1)
	resume := make(chan struct{})
	release := sync.OnceFunc(func() { close(resume) })
	workspace.operations = clusterCloseStopper(func(id string) { stopping <- id; <-resume })
	t.Cleanup(func() {
		release()
		require.True(t, workspace.waitForSelectionMutationIdle(time.Second))
	})
	accepted := make(chan error, 1)
	go func() { accepted <- workspace.CloseClusterView("app-a", "config:prod") }()
	select {
	case id := <-stopping:
		require.Equal(t, "config:prod", id)
	case <-time.After(time.Second):
		t.Fatal("close never reached cleanup")
	}
	select {
	case err := <-accepted:
		require.NoError(t, err)
	case <-time.After(100 * time.Millisecond):
		t.Fatal("multi-cluster close waited for cleanup")
	}
	require.Equal(t, []string{"/tmp/config:stage"}, workspace.GetClusterWorkspaceStateForWindow("app-a").SelectedKubeconfigs)
	require.Equal(t, []string{"/tmp/config:stage"}, app.Preferences.SelectedKubeconfigs())
	require.Same(t, stageClient, app.ClusterRuntime.clusterClientsForID("config:stage"))
	release()
	require.True(t, workspace.waitForSelectionMutationIdle(time.Second))
	// The fixture has no live refresh runtime. Failure after acceptance is
	// diagnostic, and cannot restore the closed view or discard the other one.
	diagnostics, err := workspace.GetSelectionDiagnostics()
	require.NoError(t, err)
	require.Equal(t, uint64(1), diagnostics.FailedMutations)
	require.NotEmpty(t, diagnostics.LastError)
	require.Eventually(t, func() bool {
		for _, entry := range app.AppLogs.Logger().GetEntries() {
			if entry.ClusterID == "config:prod" && entry.Level == "WARN" {
				return true
			}
		}
		return false
	}, time.Second, time.Millisecond)
	require.Equal(t, []string{"config:stage"}, workspace.WindowClusterIDs("app-a"))
}

func TestCloseClusterViewRejectsInvalidRemainingSelectionWithoutRevokingTheView(t *testing.T) {
	setTestConfigEnv(t)
	app := newWorkspaceCoordinatorTestFixture(t)
	workspace := app.Workspace
	selections := []string{"/tmp/config:prod", "/tmp/config:missing"}
	workspace.selectedKubeconfigs = selections
	workspace.GetClusterWorkspaceStateForWindow("app-a")
	tab := panelwindow.TabSnapshot{Kind: panelwindow.TabKindObject, PanelID: "pod", ActiveView: "yaml", ObjectRef: panelwindow.ObjectReference{ClusterID: "config:prod", Version: "v1", Kind: "Pod", Namespace: "default", Name: "pod"}}
	_, _, err := workspace.PanelWorkspaceDirectory().Open(tab, panelwindow.PanelLocation{Kind: panelwindow.PanelLocationDocked, WindowName: "app-a", GroupID: "right"})
	require.NoError(t, err)
	require.Error(t, workspace.CloseClusterView("app-a", "config:prod"))
	require.Equal(t, selections, workspace.GetClusterWorkspaceStateForWindow("app-a").SelectedKubeconfigs)
	require.Equal(t, selections, workspace.GetSelectedKubeconfigs())
	require.Equal(t, panelwindow.PanelLocationDocked, workspace.PanelWorkspaceDirectory().Snapshot("config:prod").Panels[0].Location.Kind)
}

func TestCloseClusterViewKeepsSharedRuntimeUntilTheLastViewCloses(t *testing.T) {
	setTestConfigEnv(t)
	app := newWorkspaceCoordinatorTestFixture(t)
	coordinator := app.Workspace
	app.ClusterRuntime.initializeClusterLifecycle()
	app.ClusterRuntime.setClusterLifecycleState("config:prod", ClusterStateReady)
	app.ClusterRuntime.ensureKubernetesAPIMetricsRegistry().getOrCreate(ClusterMeta{ID: "config:prod"}, 200, 500).record(200, time.Now())
	coordinator.kubeconfigsMu.Lock()
	coordinator.setSelectedKubeconfigsLocked([]string{"/tmp/config:prod"})
	coordinator.kubeconfigsMu.Unlock()
	coordinator.GetClusterWorkspaceStateForWindow("app-a")
	coordinator.GetClusterWorkspaceStateForWindow("app-b")
	tab := panelwindow.TabSnapshot{Kind: panelwindow.TabKindObject, PanelID: "pod", ActiveView: "yaml", ObjectRef: panelwindow.ObjectReference{ClusterID: "config:prod", Version: "v1", Kind: "Pod", Namespace: "default", Name: "pod"}}
	_, _, err := coordinator.PanelWorkspaceDirectory().Open(tab, panelwindow.PanelLocation{Kind: panelwindow.PanelLocationDocked, WindowName: "app-a", GroupID: "right"})
	require.NoError(t, err)
	require.NoError(t, app.Lifecycle.CloseClusterView("app-a", "config:prod"))
	require.Empty(t, coordinator.WindowClusterIDs("app-a"))
	require.Equal(t, []string{"config:prod"}, coordinator.WindowClusterIDs("app-b"))
	require.Equal(t, []string{"/tmp/config:prod"}, coordinator.GetSelectedKubeconfigs())
	diagnostics, err := app.ClusterRuntime.GetKubernetesAPIClientDiagnostics()
	require.NoError(t, err)
	require.Len(t, diagnostics, 1, "a peer still owns the API client diagnostics")
	require.Equal(t, int64(1), diagnostics[0].TotalRequests)
	require.Equal(t, panelwindow.PanelLocationRetained, coordinator.PanelWorkspaceDirectory().Snapshot("config:prod").Panels[0].Location.Kind)
	require.Error(t, coordinator.CloseClusterView("app-a", "config:prod"))
	require.Error(t, coordinator.CloseClusterView("app-b", "foreign"))
	require.NoError(t, coordinator.CloseClusterView("app-b", "config:prod"))
	require.Empty(t, coordinator.GetSelectedKubeconfigs())
	require.True(t, coordinator.waitForSelectionMutationIdle(time.Second))
	diagnostics, err = app.ClusterRuntime.GetKubernetesAPIClientDiagnostics()
	require.NoError(t, err)
	require.Empty(t, diagnostics)
}
