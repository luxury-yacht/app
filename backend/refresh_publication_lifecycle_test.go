package backend

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/snapshot"
	"github.com/luxury-yacht/app/backend/refresh/system"
	"github.com/stretchr/testify/require"
	cgofake "k8s.io/client-go/kubernetes/fake"
)

// Loading is the frontend's admission signal for namespace reads. Exercise the
// real construction, publication, lifecycle emitter, and HTTP consumer together.
func TestRefreshLoadingFollowsRoutePublication(t *testing.T) {
	for _, path := range []string{"startup", "selector", "first-auth-recovery", "sibling-auth-recovery"} {
		t.Run(path, func(t *testing.T) {
			for _, fetchOnLoading := range []bool{true, false} {
				name := "server-owned-readiness"
				if fetchOnLoading {
					name = "frontend-read-on-loading"
				}
				t.Run(name, func(t *testing.T) {
					testRefreshPublicationLifecycle(t, path, fetchOnLoading)
				})
			}
		})
	}
}

func testRefreshPublicationLifecycle(t *testing.T, path string, fetchOnLoading bool) {
	t.Helper()
	setTestConfigEnv(t)
	app := newRefreshCoordinatorTestFixture(t)
	setTestAppRuntimeReady(t, app.Lifecycle, context.Background())
	t.Cleanup(app.Refresh.teardownRefreshSubsystem)
	selections := []kubeconfigSelection{{Path: "/config/a", Context: "a"}, {Path: "/config/b", Context: "b"}}
	ids := make([]string, len(selections))
	app.ClusterRuntime.clusterClients = make(map[string]*clusterClients)
	for i, selection := range selections {
		meta := app.ClusterRuntime.clusterMetaForSelection(selection)
		ids[i] = meta.ID
		app.ClusterRuntime.clusterClients[meta.ID] = &clusterClients{
			meta: meta, kubeconfigPath: selection.Path, kubeconfigContext: selection.Context,
			client: cgofake.NewClientset(),
		}
	}
	service := stubSnapshotService{build: func(_ context.Context, domain, scope string) (*refresh.Snapshot, error) {
		return &refresh.Snapshot{Domain: domain, Scope: scope, Payload: snapshot.NamespaceSnapshot{
			WorkloadReadiness: snapshot.NamespaceWorkloadReady,
		}}, nil
	}}
	originalBuilder := newRefreshSubsystemWithServices
	newRefreshSubsystemWithServices = func(cfg system.Config) (*system.Subsystem, error) {
		return &system.Subsystem{
			Manager: refresh.NewManager(nil, nil, nil, nil, nil), SnapshotService: service,
			ClusterMeta:        snapshot.ClusterMeta{ClusterID: cfg.ClusterID, ClusterName: cfg.ClusterName},
			NamespacesDoorbell: &system.NamespacesDoorbellObserver{},
		}, nil
	}
	t.Cleanup(func() { newRefreshSubsystemWithServices = originalBuilder })

	responses := make(chan *httptest.ResponseRecorder, 8)
	app.ClusterRuntime.clusterLifecycle = newClusterLifecycle(func(id string, state, _ ClusterLifecycleState) {
		if state == ClusterStateLoading && fetchOnLoading {
			responses <- namespacePublicationResponse(app.Refresh, id)
		}
	})
	t.Cleanup(func() {
		for id := range app.ClusterRuntime.clusterLifecycle.GetAllStates() {
			app.ClusterRuntime.clusterLifecycle.Remove(id)
		}
	})
	for _, id := range ids {
		app.ClusterRuntime.setClusterLifecycleState(id, ClusterStateConnected)
	}
	require.Equal(t, http.StatusServiceUnavailable, namespacePublicationResponse(app.Refresh, ids[0]).Code,
		"requests before publication must still be rejected")

	switch path {
	case "startup":
		require.NoError(t, app.Refresh.setupRefreshSubsystemForSelections(selections))
	case "selector", "sibling-auth-recovery":
		require.NoError(t, app.Refresh.setupRefreshSubsystemForSelections(selections[:1]))
		if path == "selector" {
			require.NoError(t, app.Refresh.updateRefreshSubsystemSelections(selections))
		} else {
			activatePublicationTestCluster(t, app.Refresh, selections[1], app.ClusterRuntime.clusterClientsForID(ids[1]))
		}
	case "first-auth-recovery":
		activatePublicationTestCluster(t, app.Refresh, selections[0], app.ClusterRuntime.clusterClientsForID(ids[0]))
		ids = ids[:1]
	}

	for _, id := range ids {
		if fetchOnLoading {
			select {
			case response := <-responses:
				require.Equal(t, http.StatusOK, response.Code, "loading advertised a route that cannot serve: %s", response.Body.String())
			case <-time.After(time.Second):
				t.Fatal("published cluster never announced loading")
			}
		}
		require.Eventually(t, func() bool {
			return app.ClusterRuntime.clusterLifecycleState(id) == ClusterStateReady
		}, time.Second, time.Millisecond, "publication must allow readiness without a frontend fetch")
	}
}

func activatePublicationTestCluster(t *testing.T, coordinator *RefreshCoordinator, selection kubeconfigSelection, clients *clusterClients) {
	t.Helper()
	coordinator.clusterRuntime.setClusterLifecycleState(clients.meta.ID, ClusterStateAuthFailed)
	subsystem, err := coordinator.buildRefreshSubsystemForSelection(selection, clients, clients.meta)
	require.NoError(t, err)
	rebuild := clusterSubsystemRebuild{refresh: coordinator, clusterID: clients.meta.ID, selection: selection}
	require.True(t, rebuild.activateSubsystem(clients, subsystem))
}

func namespacePublicationResponse(coordinator *RefreshCoordinator, id string) *httptest.ResponseRecorder {
	response := httptest.NewRecorder()
	coordinator.ServeHTTP(response, httptest.NewRequest(http.MethodGet,
		"/snapshots/namespaces?scope="+url.QueryEscape(refresh.JoinClusterScope(id, "")), nil))
	return response
}

func TestFailedRefreshPublicationDoesNotAdvertiseLoading(t *testing.T) {
	for _, failure := range []string{"runtime-unavailable", "authentication", "construction", "manager-start", "recovery-routing"} {
		t.Run(failure, func(t *testing.T) {
			setTestConfigEnv(t)
			app := newRefreshCoordinatorTestFixture(t)
			t.Cleanup(app.Refresh.teardownRefreshSubsystem)
			if failure != "runtime-unavailable" {
				setTestAppRuntimeReady(t, app.Lifecycle, context.Background())
			}
			selection := kubeconfigSelection{Path: "/config/a", Context: "a"}
			meta := app.ClusterRuntime.clusterMetaForSelection(selection)
			clients := &clusterClients{
				meta: meta, kubeconfigPath: selection.Path, kubeconfigContext: selection.Context,
				client: cgofake.NewClientset(), authFailedOnInit: failure == "authentication",
			}
			app.ClusterRuntime.clusterClients = map[string]*clusterClients{meta.ID: clients}
			app.ClusterRuntime.clusterLifecycle = newClusterLifecycle(nil)
			app.ClusterRuntime.setClusterLifecycleState(meta.ID, ClusterStateAuthFailed)
			t.Cleanup(func() { app.ClusterRuntime.clusterLifecycle.Remove(meta.ID) })
			originalBuilder := newRefreshSubsystemWithServices
			newRefreshSubsystemWithServices = func(system.Config) (*system.Subsystem, error) {
				if failure == "construction" {
					return nil, errors.New("construction failed")
				}
				return &system.Subsystem{}, nil
			}
			t.Cleanup(func() { newRefreshSubsystemWithServices = originalBuilder })

			if failure == "recovery-routing" {
				rebuild := clusterSubsystemRebuild{refresh: app.Refresh, clusterID: meta.ID}
				require.False(t, rebuild.bootstrapRefreshRouting(nil, nil))
			} else {
				err := app.Refresh.setupRefreshSubsystemForSelections([]kubeconfigSelection{selection})
				if failure == "authentication" {
					require.NoError(t, err, "auth failures remain recoverable")
				} else {
					require.Error(t, err)
				}
			}
			require.Equal(t, ClusterStateAuthFailed, app.ClusterRuntime.clusterLifecycleState(meta.ID))
			require.Equal(t, http.StatusServiceUnavailable, namespacePublicationResponse(app.Refresh, meta.ID).Code)
		})
	}
}
