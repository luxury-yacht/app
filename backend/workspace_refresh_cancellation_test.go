package backend

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/snapshot"
	"github.com/luxury-yacht/app/backend/refresh/system"
	"github.com/stretchr/testify/require"
	authorizationv1 "k8s.io/api/authorization/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/kubernetes/fake"
	"k8s.io/client-go/rest"
)

// Use actual refresh construction and permission HTTP calls. Client preflight
// has finished by this point, so only the refresh operation context can cancel it.
func TestClosingTabCancelsRefreshPermissionStartup(t *testing.T) {
	for _, resource := range []string{"namespaces", "deployments"} {
		for _, withSibling := range []bool{false, true} {
			path := "setup/"
			if withSibling {
				path = "update/"
			}
			t.Run(path+resource, func(t *testing.T) {
				setTestConfigEnv(t)
				started := make(chan struct{})
				release := make(chan struct{})
				unblock := sync.OnceFunc(func() { close(release) })
				var once sync.Once
				server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					var review authorizationv1.SelfSubjectAccessReview
					if r.Method != http.MethodPost || json.NewDecoder(r.Body).Decode(&review) != nil {
						http.NotFound(w, r)
						return
					}
					if review.Spec.ResourceAttributes.Resource == resource {
						once.Do(func() { close(started) })
						select {
						case <-r.Context().Done():
							return
						case <-release:
						}
					}
					review.APIVersion = "authorization.k8s.io/v1"
					review.Kind = "SelfSubjectAccessReview"
					w.Header().Set("Content-Type", "application/json")
					_ = json.NewEncoder(w).Encode(review)
				}))
				defer server.Close()
				defer unblock()
				app := newWorkspaceCoordinatorTestFixture(t)
				w := app.Workspace
				setTestAppRuntimeReady(t, app.Lifecycle, context.Background())
				app.ClusterRuntime.initializeClusterLifecycle()
				defer func() {
					w.cancelActiveSelectionGeneration()
					unblock()
					require.True(t, w.waitForSelectionMutationIdle(5*time.Second))
					app.Refresh.teardownRefreshSubsystem()
					w.clearClusterRuntime()
				}()
				selection := kubeconfigSelection{Path: "/tmp/config", Context: "slow"}
				meta := app.ClusterRuntime.clusterMetaForSelection(selection)
				cfg := &rest.Config{Host: server.URL, QPS: 1000, Burst: 1000, ContentConfig: rest.ContentConfig{ContentType: "application/json", AcceptContentTypes: "application/json"}}
				client, err := kubernetes.NewForConfig(cfg)
				require.NoError(t, err)
				app.ClusterRuntime.availableKubeconfigs = []KubeconfigInfo{
					{Name: "config", Path: selection.Path, Context: selection.Context},
					{Name: "config", Path: selection.Path, Context: "healthy"},
				}
				selected := []string{selection.String()}
				originalBuilder := newRefreshSubsystemWithServices
				newRefreshSubsystemWithServices = func(ctx context.Context, cfg system.Config) (*system.Subsystem, error) {
					if cfg.ClusterID != "config:healthy" {
						return originalBuilder(ctx, cfg)
					}
					// Only the sibling's data source is substituted; the blocked
					// cluster uses the actual constructor and HTTP permission checks.
					return &system.Subsystem{
						Manager: refresh.NewManager(nil, nil, nil, nil, nil),
						SnapshotService: stubSnapshotService{build: func(_ context.Context, domain, scope string) (*refresh.Snapshot, error) {
							return &refresh.Snapshot{Domain: domain, Scope: scope, Payload: snapshot.NamespaceSnapshot{WorkloadReadiness: snapshot.NamespaceWorkloadReady}}, nil
						}},
						ClusterMeta:        snapshot.ClusterMeta{ClusterID: cfg.ClusterID, ClusterName: cfg.ClusterName},
						NamespacesDoorbell: &system.NamespacesDoorbellObserver{},
					}, nil
				}
				defer func() { newRefreshSubsystemWithServices = originalBuilder }()
				var healthy *clusterClients
				if withSibling {
					healthySelection := kubeconfigSelection{Path: selection.Path, Context: "healthy"}
					healthyMeta := app.ClusterRuntime.clusterMetaForSelection(healthySelection)
					healthy = &clusterClients{meta: healthyMeta, kubeconfigPath: healthySelection.Path, kubeconfigContext: healthySelection.Context, client: fake.NewClientset()}
					app.ClusterRuntime.replaceClusterClient(healthyMeta.ID, healthy)
					result := w.ApplyClusterWorkspace(ClusterWorkspaceCommand{WindowID: "app-a", UpdateSelectedKubeconfigs: true, SelectedKubeconfigs: []string{healthySelection.String()}})
					require.Empty(t, result.Error)
					require.True(t, w.waitForSelectionMutationIdle(5*time.Second))
					require.NotNil(t, app.Refresh.getRefreshSubsystem(healthyMeta.ID))
					selected = append(selected, healthySelection.String())
				}
				app.ClusterRuntime.replaceClusterClient(meta.ID, &clusterClients{
					meta: meta, kubeconfigPath: selection.Path, kubeconfigContext: selection.Context, client: client, restConfig: cfg,
				})
				opened := w.ApplyClusterWorkspace(ClusterWorkspaceCommand{WindowID: "app-a", UpdateSelectedKubeconfigs: true, SelectedKubeconfigs: selected})
				require.Empty(t, opened.Error)
				select {
				case <-started:
				case <-time.After(5 * time.Second):
					t.Fatal("refresh never reached the permission request")
				}
				closed := make(chan error, 1)
				go func() {
					if err := w.ReleasePanelCluster("panel-workspace:" + meta.ID); err != nil {
						closed <- err
						return
					}
					closed <- w.CloseClusterView("app-a", meta.ID)
				}()
				select {
				case err := <-closed:
					require.NoError(t, err)
				case <-time.After(time.Second):
					t.Error("tab close did not cancel refresh permission startup")
					unblock()
					require.NoError(t, <-closed)
				}
				require.True(t, w.waitForSelectionMutationIdle(time.Second))
				if withSibling {
					require.Equal(t, []string{"/tmp/config:healthy"}, w.GetSelectedKubeconfigs())
					require.Same(t, healthy, app.ClusterRuntime.clusterClientsForID(healthy.meta.ID))
					require.Equal(t, http.StatusOK, namespacePublicationResponse(app.Refresh, healthy.meta.ID).Code)
					require.NotNil(t, app.Refresh.getRefreshSubsystem(healthy.meta.ID))
					// The same retention boundary used by object-panel opens is usable again.
					require.NoError(t, w.RetainPanelCluster("panel-workspace:"+healthy.meta.ID, healthy.meta.ID))
					result := w.ApplyClusterWorkspace(ClusterWorkspaceCommand{WindowID: "app-a", VisibleClusterID: healthy.meta.ID})
					require.Empty(t, result.Error)
					require.Equal(t, healthy.meta.ID, result.State.VisibleClusterID)
				} else {
					require.Empty(t, w.GetSelectedKubeconfigs())
				}
				require.Nil(t, app.Refresh.getRefreshSubsystem(meta.ID), "cancelled construction must not publish a subsystem")
			})
		}
	}
}
