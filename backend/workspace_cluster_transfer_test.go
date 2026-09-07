package backend

import (
	"github.com/luxury-yacht/app/internal/panelwindow"
	"github.com/stretchr/testify/require"
	"testing"
)

func TestClusterViewTransferKeepsRuntimeSelectionAndMovesOnlySourceView(t *testing.T) {
	setTestConfigEnv(t)
	app := newWorkspaceCoordinatorTestFixture(t)
	coordinator := app.Workspace
	selection, clusterID := "/tmp/config:prod", "config:prod"
	coordinator.kubeconfigsMu.Lock()
	coordinator.setSelectedKubeconfigsLocked([]string{selection})
	coordinator.kubeconfigsMu.Unlock()
	coordinator.GetClusterWorkspaceStateForWindow("app-a")
	coordinator.GetClusterWorkspaceStateForWindow("app-c")
	tab := panelwindow.TabSnapshot{Kind: panelwindow.TabKindObject, PanelID: "pod", ActiveView: "yaml", ObjectRef: panelwindow.ObjectReference{ClusterID: clusterID, Version: "v1", Kind: "Pod", Namespace: "default", Name: "pod"}}
	groups := []panelwindow.WorkspaceGroup{{ClusterID: clusterID, GroupID: "right", Tabs: []panelwindow.TabSnapshot{tab}, ActivePanelID: tab.PanelID}}
	require.NoError(t, coordinator.PanelWorkspaceDirectory().PublishWindow("app-a", panelwindow.PanelLocationDocked, groups))
	alreadyOpen, err := coordinator.StageClusterViewTransfer("app-a", "app-b", clusterID)
	require.NoError(t, err)
	require.False(t, alreadyOpen)
	require.Equal(t, []string{selection}, coordinator.GetSelectedKubeconfigs())
	require.Equal(t, []string{clusterID}, coordinator.WindowClusterIDs("app-a"))
	require.Equal(t, []string{clusterID}, coordinator.WindowClusterIDs("app-b"))
	require.Error(t, coordinator.CommitClusterViewTransfer("app-a", "app-b", clusterID, nil))
	require.Equal(t, []string{clusterID}, coordinator.WindowClusterIDs("app-a"))
	require.NoError(t, coordinator.CommitClusterViewTransfer("app-a", "app-b", clusterID, groups))
	require.Empty(t, coordinator.WindowClusterIDs("app-a"))
	require.Equal(t, []string{clusterID}, coordinator.WindowClusterIDs("app-b"))
	require.Equal(t, []string{clusterID}, coordinator.WindowClusterIDs("app-c"))
	require.Equal(t, []string{selection}, coordinator.GetSelectedKubeconfigs())
	require.Equal(t, "app-b", coordinator.PanelWorkspaceDirectory().Snapshot(clusterID).Panels[0].Location.WindowName)
}

func TestCancellingStagedClusterViewPreservesSourceAndExistingDestination(t *testing.T) {
	setTestConfigEnv(t)
	app := newWorkspaceCoordinatorTestFixture(t)
	coordinator := app.Workspace
	coordinator.kubeconfigsMu.Lock()
	coordinator.setSelectedKubeconfigsLocked([]string{"/tmp/config:prod"})
	coordinator.kubeconfigsMu.Unlock()
	coordinator.GetClusterWorkspaceStateForWindow("app-a")
	alreadyOpen, err := coordinator.StageClusterViewTransfer("app-a", "app-b", "config:prod")
	require.NoError(t, err)
	require.False(t, alreadyOpen)
	require.NoError(t, coordinator.CancelClusterViewTransfer("app-b", "config:prod"))
	require.Empty(t, coordinator.WindowClusterIDs("app-b"))
	require.Equal(t, []string{"config:prod"}, coordinator.WindowClusterIDs("app-a"))
	alreadyOpen, err = coordinator.StageClusterViewTransfer("app-a", "app-a", "config:prod")
	require.Error(t, err)
	require.False(t, alreadyOpen)
}

func TestPanelOnlyClusterCanSeedAnAppViewWithoutOtherClusters(t *testing.T) {
	setTestConfigEnv(t)
	coordinator := newWorkspaceCoordinatorTestFixture(t).Workspace
	coordinator.kubeconfigsMu.Lock()
	coordinator.setSelectedKubeconfigsLocked([]string{"/tmp/config:prod", "/tmp/config:stage"})
	coordinator.kubeconfigsMu.Unlock()
	require.NoError(t, coordinator.RetainPanelCluster("panel-1", "config:prod"))
	alreadyOpen, err := coordinator.StageClusterViewTransfer("panel-1", "app-new", "config:prod")
	require.NoError(t, err)
	require.False(t, alreadyOpen)
	require.Equal(t, []string{"config:prod"}, coordinator.WindowClusterIDs("app-new"))
	require.Error(t, coordinator.CommitClusterViewTransfer("panel-1", "app-new", "config:prod", nil))
}
