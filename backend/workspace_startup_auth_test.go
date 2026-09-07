package backend

import (
	"context"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/internal/authstate"
	"github.com/stretchr/testify/require"
)

func TestStartupPanelBookkeepingPreservesAuthenticationResults(t *testing.T) {
	for _, action := range []string{"release-absent", "retain", "release-retained", "open-peer", "close-peer", "move-cluster", "cancel-move", "auth-recovering"} {
		t.Run(action, func(t *testing.T) {
			setTestConfigEnv(t)
			app := newWorkspaceCoordinatorTestFixture(t)
			selections := []string{"/tmp/config:expired", "/tmp/config:healthy"}
			app.ClusterRuntime.availableKubeconfigs = []KubeconfigInfo{
				{Name: "config", Path: "/tmp/config", Context: "expired"},
				{Name: "config", Path: "/tmp/config", Context: "healthy"},
			}
			settings := defaultSettingsFile()
			settings.Kubeconfig.Selected = selections
			require.NoError(t, app.Preferences.saveSettingsFile(settings))
			_, startupCtx, err := app.Workspace.initializeSelectedClustersAtStartup()
			require.NoError(t, err)
			app.Workspace.GetClusterWorkspaceStateForWindow("workspace-1")
			if action == "release-retained" {
				app.Workspace.panelSelections = map[string]string{"panel-workspace:config:expired": selections[0]}
			}

			started := make(chan struct{}, 2)
			resume := make(chan struct{})
			app.Workspace.kubeClientInitializer = func(ctx context.Context) error {
				selected, err := app.Workspace.selectedKubeconfigSelections()
				if err != nil {
					return err
				}
				return app.Workspace.syncClusterClientPoolWithBuilder(ctx, selected,
					func(_ context.Context, selection kubeconfigSelection, meta ClusterMeta) (*clusterClients, error) {
						started <- struct{}{}
						<-resume
						manager := authstate.New(authstate.Config{MaxAttempts: 0})
						t.Cleanup(manager.Shutdown)
						if selection.Context == "expired" {
							manager.ReportFailure("SSO token has expired")
						}
						return &clusterClients{meta: meta, kubeconfigPath: selection.Path,
							kubeconfigContext: selection.Context, client: createHealthyClient(), authManager: manager}, nil
					})
			}
			connected := make(chan error, 1)
			go func() { connected <- app.Workspace.connectSelectedClustersAtStartup(startupCtx) }()
			for range 2 {
				select {
				case <-started:
				case <-time.After(time.Second):
					close(resume)
					t.Fatal("startup did not begin both client builds")
				}
			}

			switch action {
			case "auth-recovering":
				app.Workspace.consumeClusterRuntimeIntent(ClusterRuntimeIntent{
					Kind: ClusterRuntimeIntentAuthRebuild, ClusterID: "config:expired", Generation: 1,
					AuthState: authstate.StateRecovering,
				})
				require.Eventually(t, func() bool {
					app.Workspace.selectionMutationDrainMu.Lock()
					defer app.Workspace.selectionMutationDrainMu.Unlock()
					return app.Workspace.selectionMutationPending > 0
				}, time.Second, time.Millisecond)
			case "retain":
				err = app.Workspace.RetainPanelCluster("panel-workspace:config:expired", "config:expired")
			case "open-peer":
				result := app.Workspace.ApplyClusterWorkspace(ClusterWorkspaceCommand{
					WindowID: "workspace-2", UpdateSelectedKubeconfigs: true, SelectedKubeconfigs: selections,
				})
				require.Empty(t, result.Error)
			case "close-peer":
				app.Workspace.GetClusterWorkspaceStateForWindow("workspace-2")
				app.Workspace.ReleaseWorkspaceWindow("workspace-1")
			case "move-cluster", "cancel-move":
				_, err = app.Workspace.StageClusterViewTransfer("workspace-1", "workspace-2", "config:expired")
				if err == nil && action == "move-cluster" {
					err = app.Workspace.CommitClusterViewTransfer("workspace-1", "workspace-2", "config:expired", nil)
				} else if err == nil {
					err = app.Workspace.CancelClusterViewTransfer("workspace-2", "config:expired")
				}
			default:
				err = app.Workspace.ReleasePanelCluster("panel-workspace:config:expired")
			}
			close(resume)
			connectionErr := <-connected
			require.True(t, app.Workspace.waitForSelectionMutationIdle(time.Second))
			require.NoError(t, err)
			require.NoError(t, startupCtx.Err(), "unchanged cluster selections must preserve startup connection work")
			require.NoError(t, connectionErr, "panel bookkeeping must not discard startup authentication results")
			state := app.Workspace.GetClusterWorkspaceState()
			require.Equal(t, selections, state.SelectedKubeconfigs)
			require.Equal(t, "invalid", state.Clusters["config:expired"].Auth.State)
			require.Equal(t, "SSO token has expired", state.Clusters["config:expired"].Auth.Reason)
			require.Equal(t, "valid", state.Clusters["config:healthy"].Auth.State)
		})
	}
}
