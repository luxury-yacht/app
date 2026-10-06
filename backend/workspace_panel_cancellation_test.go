package backend

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// This is the ordering used by native cluster close: release the removed
// workspace's panel reference, then commit the tab close that cancels connection.
func TestEmptyPanelWorkspaceReleaseAllowsPendingTabClose(t *testing.T) {
	setTestConfigEnv(t)
	app := newWorkspaceCoordinatorTestFixture(t)
	w := app.Workspace
	app.ClusterRuntime.clusterLifecycle = newClusterLifecycle(nil)
	app.ClusterRuntime.availableKubeconfigs = []KubeconfigInfo{{Name: "config", Path: "/tmp/config", Context: "slow"}}
	runtime := &pendingTabRuntime{workspaceClusterRuntime: w.clusterRuntime, started: make(chan struct{})}
	w.clusterRuntime = runtime
	t.Cleanup(func() {
		w.cancelActiveSelectionGeneration()
		require.True(t, w.waitForSelectionMutationIdle(time.Second))
	})
	opened := w.ApplyClusterWorkspace(ClusterWorkspaceCommand{
		WindowID: "app-a", UpdateSelectedKubeconfigs: true,
		SelectedKubeconfigs: []string{"/tmp/config:slow"},
	})
	require.Empty(t, opened.Error)
	<-runtime.started
	closed := make(chan error, 1)
	go func() {
		if err := w.ReleasePanelCluster("panel-workspace:config:slow"); err != nil {
			closed <- err
			return
		}
		closed <- w.CloseClusterView("app-a", "config:slow")
	}()
	select {
	case err := <-closed:
		require.NoError(t, err)
	case <-time.After(time.Second):
		t.Error("empty panel reference blocked the close that cancels connection")
		w.cancelActiveSelectionGeneration()
		require.NoError(t, <-closed)
	}
	require.True(t, w.waitForSelectionMutationIdle(time.Second))
	require.Empty(t, w.GetSelectedKubeconfigs())
}
