package backend

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

type pendingTabRuntime struct {
	workspaceClusterRuntime
	started chan struct{}
	once    sync.Once
}

func (r *pendingTabRuntime) buildClusterClientsWithContext(ctx context.Context, selection kubeconfigSelection, meta ClusterMeta) (*clusterClients, error) {
	r.once.Do(func() { close(r.started) })
	<-ctx.Done()
	// A late external helper may still return clients after cancellation.
	return &clusterClients{meta: meta, kubeconfigPath: selection.Path, kubeconfigContext: selection.Context}, nil
}

func TestWorkspaceTabAdmissionAndCloseDoNotWaitForConnection(t *testing.T) {
	setTestConfigEnv(t)
	app := newWorkspaceCoordinatorTestFixture(t)
	w := app.Workspace
	app.ClusterRuntime.clusterLifecycle = newClusterLifecycle(nil)
	selection := "/tmp/config:slow"
	app.ClusterRuntime.availableKubeconfigs = []KubeconfigInfo{{Name: "config", Path: "/tmp/config", Context: "slow"}}
	runtime := &pendingTabRuntime{workspaceClusterRuntime: w.clusterRuntime, started: make(chan struct{})}
	w.clusterRuntime = runtime
	t.Cleanup(func() {
		w.cancelActiveSelectionGeneration()
		require.True(t, w.waitForSelectionMutationIdle(time.Second))
	})
	opened := make(chan ClusterWorkspaceResult, 1)
	go func() {
		opened <- w.ApplyClusterWorkspace(ClusterWorkspaceCommand{
			WindowID: "app-a", UpdateSelectedKubeconfigs: true,
			SelectedKubeconfigs: []string{selection}, VisibleClusterID: "config:slow",
		})
	}()
	<-runtime.started
	select {
	case result := <-opened:
		require.Empty(t, result.Error)
		require.Equal(t, []string{selection}, result.State.SelectedKubeconfigs)
	case <-time.After(100 * time.Millisecond):
		t.Fatal("opening the tab waited for the cluster connection")
	}
	closed := make(chan error, 1)
	go func() { closed <- w.CloseClusterView("app-a", "config:slow") }()
	select {
	case err := <-closed:
		require.NoError(t, err)
	case <-time.After(100 * time.Millisecond):
		t.Fatal("closing the tab waited for the cluster connection")
	}
	require.True(t, w.waitForSelectionMutationIdle(time.Second))
	require.Empty(t, w.GetClusterWorkspaceStateForWindow("app-a").SelectedKubeconfigs)
	require.Empty(t, w.GetSelectedKubeconfigs())
	require.Empty(t, app.ClusterRuntime.snapshotClusterIDs())
	require.Empty(t, app.ClusterRuntime.clusterLifecycleStates())
}

func TestAcceptedTabConnectionFailureLeavesAnUnavailableTabWithDiagnostics(t *testing.T) {
	setTestConfigEnv(t)
	app := newWorkspaceCoordinatorTestFixture(t)
	app.ClusterRuntime.clusterLifecycle = newClusterLifecycle(nil)
	app.ClusterRuntime.availableKubeconfigs = []KubeconfigInfo{{Name: "missing", Path: "/tmp/missing-tab-config", Context: "dev"}}
	result := app.Workspace.ApplyClusterWorkspace(ClusterWorkspaceCommand{
		WindowID: "app-a", UpdateSelectedKubeconfigs: true, SelectedKubeconfigs: []string{"/tmp/missing-tab-config:dev"},
	})
	require.Empty(t, result.Error)
	require.True(t, app.Workspace.waitForSelectionMutationIdle(time.Second))
	state := app.Workspace.GetClusterWorkspaceStateForWindow("app-a")
	require.Equal(t, []string{"/tmp/missing-tab-config:dev"}, state.SelectedKubeconfigs)
	require.Equal(t, ClusterStateDisconnected, state.Clusters["missing:dev"].Lifecycle)
	diagnostics, err := app.Workspace.GetSelectionDiagnostics()
	require.NoError(t, err)
	require.NotEmpty(t, diagnostics.LastError)
}
