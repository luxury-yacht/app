package backend

import (
	"github.com/luxury-yacht/app/internal/panelwindow"
	"github.com/stretchr/testify/require"
	"testing"
)

func TestCloseClusterViewKeepsSharedRuntimeUntilTheLastViewCloses(t *testing.T) {
	setTestConfigEnv(t)
	app := newWorkspaceCoordinatorTestFixture(t)
	coordinator := app.Workspace
	coordinator.kubeconfigsMu.Lock()
	coordinator.setSelectedKubeconfigsLocked([]string{"/tmp/config:prod"})
	coordinator.kubeconfigsMu.Unlock()
	coordinator.GetClusterWorkspaceStateForWindow("app-a")
	coordinator.GetClusterWorkspaceStateForWindow("app-b")
	tab := panelwindow.TabSnapshot{Kind: panelwindow.TabKindObject, PanelID: "pod", ActiveView: "yaml", ObjectRef: panelwindow.ObjectReference{ClusterID: "config:prod", Version: "v1", Kind: "Pod", Namespace: "default", Name: "pod"}}
	_, _, err := coordinator.PanelWorkspaceDirectory().Open(tab, panelwindow.PanelLocation{Kind: panelwindow.PanelLocationDocked, WindowName: "app-a", GroupID: "right"})
	require.NoError(t, err)
	require.NoError(t, app.Lifecycle.CloseClusterView("app-a", "config:prod"))
	require.Empty(t, coordinator.WindowClusterIDs("app-a"))
	require.Equal(t, []string{"config:prod"}, coordinator.WindowClusterIDs("app-b"))
	require.Equal(t, []string{"/tmp/config:prod"}, coordinator.GetSelectedKubeconfigs())
	require.Equal(t, panelwindow.PanelLocationRetained, coordinator.PanelWorkspaceDirectory().Snapshot("config:prod").Panels[0].Location.Kind)
	require.Error(t, coordinator.CloseClusterView("app-a", "config:prod"))
	require.Error(t, coordinator.CloseClusterView("app-b", "foreign"))
	require.NoError(t, coordinator.CloseClusterView("app-b", "config:prod"))
	require.Empty(t, coordinator.GetSelectedKubeconfigs())
}
