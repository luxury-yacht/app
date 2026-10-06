package backend

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

type pendingPanelSiblingRuntime struct {
	workspaceClusterRuntime
	started chan context.Context
}

func (r *pendingPanelSiblingRuntime) buildClusterClientsWithContext(ctx context.Context, _ kubeconfigSelection, _ ClusterMeta) (*clusterClients, error) {
	r.started <- ctx
	<-ctx.Done()
	return nil, ctx.Err()
}

func TestPanelBookkeepingDuringPendingSiblingConnection(t *testing.T) {
	for _, action := range []string{"retain-new", "retain-existing", "release-absent", "release-owned", "retain-foreign"} {
		t.Run(action, func(t *testing.T) {
			setTestConfigEnv(t)
			app := newWorkspaceCoordinatorTestFixture(t)
			w := app.Workspace
			app.ClusterRuntime.clusterLifecycle = newClusterLifecycle(nil)
			w.selectedKubeconfigs = []string{"/tmp/config:healthy"}
			app.ClusterRuntime.availableKubeconfigs = []KubeconfigInfo{
				{Name: "config", Path: "/tmp/config", Context: "healthy"},
				{Name: "config", Path: "/tmp/config", Context: "slow"},
			}
			app.ClusterRuntime.clusterClients = map[string]*clusterClients{
				"config:healthy": {meta: ClusterMeta{ID: "config:healthy"}, kubeconfigPath: "/tmp/config", kubeconfigContext: "healthy", client: createHealthyClient()},
			}
			w.GetClusterWorkspaceStateForWindow("workspace-1")
			const reference = "panel-workspace:config:healthy"
			if action == "retain-existing" || action == "release-owned" || action == "retain-foreign" {
				require.NoError(t, w.RetainPanelCluster(reference, "config:healthy"))
			}
			pending := &pendingPanelSiblingRuntime{workspaceClusterRuntime: w.clusterRuntime, started: make(chan context.Context, 1)}
			w.clusterRuntime = pending
			result := make(chan error, 1)
			t.Cleanup(func() {
				w.cancelActiveSelectionGeneration()
				require.True(t, w.waitForSelectionMutationIdle(time.Second))
			})
			admitted := w.ApplyClusterWorkspace(ClusterWorkspaceCommand{
				WindowID: "workspace-1", UpdateSelectedKubeconfigs: true,
				SelectedKubeconfigs: []string{"/tmp/config:healthy", "/tmp/config:slow"},
			})
			require.Empty(t, admitted.Error)
			var connecting context.Context
			select {
			case connecting = <-pending.started:
			case <-time.After(time.Second):
				t.Fatal("connection did not start")
			}
			generation := w.selectionGeneration.Load()
			go func() {
				if action == "retain-foreign" {
					result <- w.RetainPanelCluster(reference, "config:slow")
				} else if action == "retain-new" || action == "retain-existing" {
					result <- w.RetainPanelCluster(reference, "config:healthy")
				} else {
					result <- w.ReleasePanelCluster(reference)
				}
			}()
			select {
			case err := <-result:
				if action == "retain-foreign" {
					require.Error(t, err)
				} else {
					require.NoError(t, err)
				}
			case <-time.After(time.Second):
				t.Error("healthy panel bookkeeping waited for the unreachable sibling")
				w.cancelActiveSelectionGeneration()
				require.NoError(t, <-result)
				return
			}
			require.NoError(t, connecting.Err(), "panel bookkeeping must not cancel another cluster's connection")
			require.Equal(t, generation, w.selectionGeneration.Load())
			if action == "retain-new" || action == "retain-existing" || action == "retain-foreign" {
				require.Equal(t, []string{"/tmp/config:healthy"}, w.GetClusterWorkspaceStateForWindow(reference).SelectedKubeconfigs)
			}
		})
	}
}

// The membership snapshot can precede its process-selection commit. A late
// retention must not resurrect a cluster after its final owner was removed.
func TestPanelRetentionCannotOvertakeLastOwnerRemoval(t *testing.T) {
	setTestConfigEnv(t)
	app := newWorkspaceCoordinatorTestFixture(t)
	w := app.Workspace
	selection, clusterID := "/tmp/config:closing", "config:closing"
	w.selectedKubeconfigs = []string{selection}
	app.ClusterRuntime.availableKubeconfigs = []KubeconfigInfo{{Name: "config", Path: "/tmp/config", Context: "closing"}}
	w.GetClusterWorkspaceStateForWindow("workspace-1")
	removed, resume := make(chan struct{}), make(chan struct{})
	closing := make(chan error, 1)
	go func() {
		closing <- w.runOrderedSelectionMutation("close-cluster-view", func(mutation *selectionMutation) error {
			intent, err := w.removeClusterView(mutation, "workspace-1", clusterID)
			if err != nil {
				return err
			}
			close(removed)
			<-resume
			if intent != nil {
				w.commitKubeconfigSelection(mutation, intent)
			}
			return nil
		})
	}()
	released := false
	defer func() {
		if !released {
			close(resume)
		}
		require.True(t, w.waitForSelectionMutationIdle(time.Second))
	}()
	select {
	case <-removed:
	case <-time.After(time.Second):
		t.Fatal("close did not remove the last owner")
	}
	require.Empty(t, w.WindowClusterIDs("workspace-1"))
	require.Equal(t, []string{selection}, w.GetSelectedKubeconfigs(), "the runtime selection has not committed yet")
	retained := make(chan error, 1)
	go func() { retained <- w.RetainPanelCluster("late-panel", clusterID) }()
	require.Eventually(t, func() bool {
		diagnostics, err := w.GetSelectionDiagnostics()
		return err == nil && diagnostics.ActiveQueueDepth == 2
	}, time.Second, time.Millisecond, "retaining a closing cluster must wait for ordered retirement")
	w.workspaceSelectionsMu.RLock()
	_, admitted := w.panelSelections["late-panel"]
	w.workspaceSelectionsMu.RUnlock()
	require.False(t, admitted)
	close(resume)
	released = true
	require.NoError(t, <-closing)
	require.Error(t, <-retained)
	require.Empty(t, w.GetSelectedKubeconfigs())
}
