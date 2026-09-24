package backend

import (
	"context"
	"errors"
	"net/http"
	"sync"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/snapshot"
	"github.com/luxury-yacht/app/backend/refresh/system"
	"github.com/stretchr/testify/require"
	cgofake "k8s.io/client-go/kubernetes/fake"
)

type failingSiblingRuntime struct {
	workspaceClusterRuntime
	failed <-chan struct{}
}

func (r *failingSiblingRuntime) buildClusterClientsWithContext(ctx context.Context, selection kubeconfigSelection, meta ClusterMeta) (*clusterClients, error) {
	if selection.Context == "bad" {
		return nil, errors.New("cluster client construction failed")
	}
	select {
	case <-r.failed:
	case <-ctx.Done():
		return nil, ctx.Err()
	}
	return &clusterClients{
		meta: meta, kubeconfigPath: selection.Path, kubeconfigContext: selection.Context,
		client: cgofake.NewClientset(),
	}, nil
}

// Exercise admission, client construction and the served namespace route together.
// Only client construction and the snapshot data source replace Kubernetes I/O.
func TestWorkspaceConnectionFailureDoesNotStrandHealthySibling(t *testing.T) {
	for _, entry := range []string{"open", "close", "startup"} {
		t.Run(entry, func(t *testing.T) {
			setTestConfigEnv(t)
			app := newWorkspaceCoordinatorTestFixture(t)
			setTestAppRuntimeReady(t, app.Lifecycle, context.Background())
			w := app.Workspace
			t.Cleanup(app.Refresh.teardownRefreshSubsystem)
			failed := make(chan struct{})
			recordFailure := sync.OnceFunc(func() { close(failed) })
			app.ClusterRuntime.clusterLifecycle = newClusterLifecycle(func(id string, state, _ ClusterLifecycleState) {
				if id == "config:bad" && state == ClusterStateDisconnected {
					recordFailure()
				}
			})
			w.clusterRuntime = &failingSiblingRuntime{workspaceClusterRuntime: w.clusterRuntime, failed: failed}
			app.ClusterRuntime.availableKubeconfigs = []KubeconfigInfo{
				{Name: "config", Path: "/tmp/config", Context: "good"},
				{Name: "config", Path: "/tmp/config", Context: "bad"},
				{Name: "config", Path: "/tmp/config", Context: "closing"},
			}
			service := stubSnapshotService{build: func(_ context.Context, domain, scope string) (*refresh.Snapshot, error) {
				return &refresh.Snapshot{Domain: domain, Scope: scope, Payload: snapshot.NamespaceSnapshot{
					WorkloadReadiness: snapshot.NamespaceWorkloadReady,
				}}, nil
			}}
			original := newRefreshSubsystemWithServices
			newRefreshSubsystemWithServices = func(cfg system.Config) (*system.Subsystem, error) {
				return &system.Subsystem{
					Manager: refresh.NewManager(nil, nil, nil, nil, nil), SnapshotService: service,
					ClusterMeta:        snapshot.ClusterMeta{ClusterID: cfg.ClusterID, ClusterName: cfg.ClusterName},
					NamespacesDoorbell: &system.NamespacesDoorbellObserver{},
				}, nil
			}
			t.Cleanup(func() { newRefreshSubsystemWithServices = original })
			t.Cleanup(func() {
				w.cancelActiveSelectionGeneration()
				require.True(t, w.waitForSelectionMutationIdle(time.Second))
			})
			selections := []string{"/tmp/config:good", "/tmp/config:bad"}
			switch entry {
			case "open":
				result := w.ApplyClusterWorkspace(ClusterWorkspaceCommand{
					WindowID: "app-a", UpdateSelectedKubeconfigs: true, SelectedKubeconfigs: selections,
				})
				require.Empty(t, result.Error)
			case "close":
				w.selectedKubeconfigs = append(append([]string{}, selections...), "/tmp/config:closing")
				w.GetClusterWorkspaceStateForWindow("app-a")
				require.NoError(t, w.CloseClusterView("app-a", "config:closing"))
			case "startup":
				w.selectedKubeconfigs = selections
				require.ErrorContains(t, w.connectSelectedClustersAtStartup(context.Background()), "construction failed")
			}
			require.True(t, w.waitForSelectionMutationIdle(time.Second))
			require.Equal(t, ClusterStateDisconnected, app.ClusterRuntime.clusterLifecycleState("config:bad"))
			require.Eventually(t, func() bool {
				return app.ClusterRuntime.clusterLifecycleState("config:good") == ClusterStateReady
			}, time.Second, time.Millisecond, "a sibling failure must not cancel healthy client construction or block refresh publication")
			require.Equal(t, http.StatusOK, namespacePublicationResponse(app.Refresh, "config:good").Code)
			require.ElementsMatch(t, selections, w.GetSelectedKubeconfigs(), "failure must preserve admitted tabs")
			// Closing the only serving tab must retire its routes even when every
			// remaining client build fails again.
			w.GetClusterWorkspaceStateForWindow("app-a")
			require.NoError(t, w.CloseClusterView("app-a", "config:good"))
			require.True(t, w.waitForSelectionMutationIdle(time.Second))
			require.Equal(t, []string{"/tmp/config:bad"}, w.GetSelectedKubeconfigs())
			require.Nil(t, app.Refresh.getRefreshSubsystem("config:good"))
			require.Nil(t, app.ClusterRuntime.clusterClientsForID("config:good"))
			require.Equal(t, http.StatusServiceUnavailable, namespacePublicationResponse(app.Refresh, "config:good").Code)
			require.Equal(t, ClusterStateDisconnected, app.ClusterRuntime.clusterLifecycleState("config:bad"))
		})
	}
}

func TestClusterClientTimeoutLeavesFailedTabDisconnected(t *testing.T) {
	app := newClusterRuntimeTestFixture(t)
	app.ClusterRuntime.clusterLifecycle = newClusterLifecycle(nil)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Millisecond)
	defer cancel()
	task := clusterClientCreateTask{meta: ClusterMeta{ID: "slow"}}
	err := app.ClusterRuntime.createClusterClients(ctx, []clusterClientCreateTask{task}, func(ctx context.Context, _ kubeconfigSelection, _ ClusterMeta) (*clusterClients, error) {
		<-ctx.Done()
		return nil, ctx.Err()
	})
	require.ErrorIs(t, err, context.DeadlineExceeded)
	require.Equal(t, ClusterStateDisconnected, app.ClusterRuntime.clusterLifecycleState("slow"))
}
