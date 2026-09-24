package backend

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// Exercise real client construction: API diagnostics exist during discovery,
// before the client pool has an entry that ordinary client cleanup can retire.
func TestClusterTabCloseRetiresAPIClientsAndDiagnostics(t *testing.T) {
	for _, test := range []struct {
		name         string
		pendingPath  string
		withSurvivor bool
	}{
		{name: "discovery with sibling", pendingPath: "/closing/", withSurvivor: true},
		{name: "last tab during discovery", pendingPath: "/closing/"},
		{name: "preflight with sibling", pendingPath: "/closing/version", withSurvivor: true},
		{name: "last tab during preflight", pendingPath: "/closing/version"},
		{name: "connected tab with sibling", withSurvivor: true},
		{name: "last connected tab"},
	} {
		t.Run(test.name, func(t *testing.T) {
			setTestConfigEnv(t)
			started := make(chan struct{})
			releaseDiscovery := make(chan struct{})
			release := sync.OnceFunc(func() { close(releaseDiscovery) })
			var once sync.Once
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if test.pendingPath != "" && strings.HasPrefix(r.URL.Path, test.pendingPath) {
					once.Do(func() { close(started) })
					select {
					case <-r.Context().Done():
						return
					case <-releaseDiscovery:
					}
				}
				w.Header().Set("Content-Type", "application/json")
				if strings.HasSuffix(r.URL.Path, "/version") {
					_, _ = w.Write([]byte(`{"major":"1","minor":"30"}`))
					return
				}
				_, _ = w.Write([]byte(`{"kind":"APIGroupList","apiVersion":"v1","groups":[]}`))
			}))
			t.Cleanup(server.Close)
			t.Cleanup(release)
			app := newWorkspaceCoordinatorTestFixture(t)
			w := app.Workspace
			runtime := app.ClusterRuntime
			runtime.initializeClusterLifecycle()
			t.Cleanup(func() {
				w.cancelActiveSelectionGeneration()
				release()
				require.True(t, w.waitForSelectionMutationIdle(time.Second))
				w.clearClusterRuntime()
			})
			closing := kubeconfigSelection{Path: writeTestKubeconfig(t, server.URL+"/closing"), Context: "test-context"}
			survivor := kubeconfigSelection{Path: writeTestKubeconfig(t, server.URL+"/survivor"), Context: "test-context"}
			runtime.availableKubeconfigs = []KubeconfigInfo{
				{Name: "closing", Path: closing.Path, Context: closing.Context},
				{Name: "survivor", Path: survivor.Path, Context: survivor.Context},
			}
			closingID := runtime.clusterMetaForSelection(closing).ID
			survivorID := runtime.clusterMetaForSelection(survivor).ID
			selections := []string{closing.String()}
			var retained *clusterClients
			var retainedDiagnostics []KubernetesAPIClientDiagnostics
			if test.withSurvivor {
				require.NoError(t, w.syncClusterClientPoolWithContext(context.Background(), []kubeconfigSelection{survivor}))
				retained = runtime.clusterClientsForID(survivorID)
				retainedDiagnostics, _ = runtime.GetKubernetesAPIClientDiagnostics()
				selections = append(selections, survivor.String())
			}
			opened := w.ApplyClusterWorkspace(ClusterWorkspaceCommand{
				WindowID: "app-a", UpdateSelectedKubeconfigs: true, SelectedKubeconfigs: selections,
			})
			require.Empty(t, opened.Error)
			if test.pendingPath != "" {
				select {
				case <-started:
				case <-time.After(time.Second):
					t.Fatal("cluster connection did not reach the pending request")
				}
				require.Nil(t, runtime.clusterClientsForID(closingID))
			} else {
				require.True(t, w.waitForSelectionMutationIdle(time.Second))
				require.NotNil(t, runtime.clusterClientsForID(closingID))
			}
			diagnostics, err := runtime.GetKubernetesAPIClientDiagnostics()
			require.NoError(t, err)
			require.Len(t, diagnostics, len(selections))

			closed := make(chan error, 1)
			go func() { closed <- w.CloseClusterView("app-a", closingID) }()
			select {
			case err := <-closed:
				require.NoError(t, err)
			case <-time.After(time.Second):
				t.Error("closing a connecting tab did not cancel its pending API request")
				release()
				require.NoError(t, <-closed)
			}
			require.True(t, w.waitForSelectionMutationIdle(time.Second))
			require.Nil(t, runtime.clusterClientsForID(closingID))
			require.NotContains(t, runtime.clusterLifecycleStates(), closingID)
			require.NotContains(t, w.WindowClusterIDs("app-a"), closingID)
			diagnostics, err = runtime.GetKubernetesAPIClientDiagnostics()
			require.NoError(t, err)
			if test.withSurvivor {
				require.Same(t, retained, runtime.clusterClientsForID(survivorID))
				require.Equal(t, []string{survivor.String()}, w.GetSelectedKubeconfigs())
				require.Len(t, diagnostics, 1, "closing a sibling must retire only that cluster's API diagnostics")
				require.Equal(t, survivorID, diagnostics[0].ClusterID)
				require.Equal(t, retainedDiagnostics[0].TotalRequests, diagnostics[0].TotalRequests)
			} else {
				require.Empty(t, w.GetSelectedKubeconfigs())
				require.Empty(t, diagnostics, "closing the last tab must retire all API diagnostics")
			}
		})
	}
}
