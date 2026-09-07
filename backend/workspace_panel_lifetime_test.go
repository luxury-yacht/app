package backend

import (
	"testing"

	"github.com/luxury-yacht/app/internal/panelwindow"
	"github.com/stretchr/testify/require"
)

func TestPanelReferenceKeepsClusterAfterLastAppTabCloses(t *testing.T) {
	setTestConfigEnv(t)
	app := newWorkspaceCoordinatorTestFixture(t)
	selection := "/tmp/config:prod"
	clusterID := "config:prod"
	app.Workspace.kubeconfigsMu.Lock()
	app.Workspace.setSelectedKubeconfigsLocked([]string{selection})
	app.Workspace.kubeconfigsMu.Unlock()
	app.Workspace.GetClusterWorkspaceStateForWindow("workspace-1")
	require.NoError(t, app.Workspace.RetainPanelCluster("panel-1", clusterID))
	require.NoError(t, app.Workspace.RetainPanelCluster("panel-2", clusterID))

	app.Workspace.ReleaseWorkspaceWindow("workspace-1")
	require.Equal(t, []string{selection}, app.Workspace.GetSelectedKubeconfigs())
	require.NoError(t, app.Workspace.ReleasePanelCluster("panel-1"))
	require.Equal(t, []string{selection}, app.Workspace.GetSelectedKubeconfigs())
	require.NoError(t, app.Workspace.ReleasePanelCluster("panel-2"))
	require.Empty(t, app.Workspace.GetSelectedKubeconfigs())
}

func TestRemovingClusterViewRetainsItsDockedPanels(t *testing.T) {
	setTestConfigEnv(t)
	app := newWorkspaceCoordinatorTestFixture(t)
	selection := "/tmp/config:prod"
	clusterID := "config:prod"
	app.Workspace.kubeconfigsMu.Lock()
	app.Workspace.setSelectedKubeconfigsLocked([]string{selection})
	app.Workspace.kubeconfigsMu.Unlock()
	app.Workspace.GetClusterWorkspaceStateForWindow("workspace-1")
	require.NoError(t, app.Workspace.RetainPanelCluster("workspace:"+clusterID, clusterID))
	directory := app.Workspace.PanelWorkspaceDirectory()
	_, _, err := directory.Open(panelwindow.TabSnapshot{Kind: panelwindow.TabKindObject, PanelID: "pod", ActiveView: "yaml", ObjectRef: panelwindow.ObjectReference{ClusterID: clusterID, Version: "v1", Kind: "Pod", Namespace: "default", Name: "pod"}}, panelwindow.PanelLocation{Kind: panelwindow.PanelLocationDocked, WindowName: "workspace-1", GroupID: "right"})
	require.NoError(t, err)
	result := app.Workspace.ApplyClusterWorkspace(ClusterWorkspaceCommand{WindowID: "workspace-1", UpdateSelectedKubeconfigs: true, SelectedKubeconfigs: []string{}})
	require.Empty(t, result.State.SelectedKubeconfigs)
	require.Equal(t, panelwindow.PanelLocationRetained, directory.Snapshot(clusterID).Panels[0].Location.Kind)
	require.Equal(t, []string{selection}, app.Workspace.GetSelectedKubeconfigs())
}

func TestPanelRendererProjectionDoesNotAcquireOtherClusterViews(t *testing.T) {
	setTestConfigEnv(t)
	app := newWorkspaceCoordinatorTestFixture(t)
	coordinator := app.Workspace
	coordinator.kubeconfigsMu.Lock()
	coordinator.setSelectedKubeconfigsLocked([]string{"/tmp/config:prod", "/tmp/config:stage"})
	coordinator.kubeconfigsMu.Unlock()
	require.NoError(t, coordinator.RetainPanelCluster("panel-1", "config:prod"))
	state := coordinator.GetClusterWorkspaceStateForWindow("panel-1")
	require.Equal(t, []string{"/tmp/config:prod"}, state.SelectedKubeconfigs)
	coordinator.workspaceSelectionsMu.RLock()
	_, becameAppView := coordinator.workspaceSelections["panel-1"]
	coordinator.workspaceSelectionsMu.RUnlock()
	require.False(t, becameAppView)
}
