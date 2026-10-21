package panelwindow

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func workspaceTab(clusterID, name string) TabSnapshot {
	return TabSnapshot{Kind: TabKindObject, PanelID: clusterID + ":" + name, ActiveView: "details", ObjectRef: ObjectReference{ClusterID: clusterID, Version: "v1", Kind: "Pod", Namespace: "default", Name: name}}
}

func TestWorkspaceOpenSharesPanelAcrossAppWindows(t *testing.T) {
	directory := NewWorkspaceDirectory()
	tab := workspaceTab("production", "api")
	first, created, err := directory.Open(tab, PanelLocation{Kind: PanelLocationDocked, WindowName: "app-a", GroupID: "right"})
	require.NoError(t, err)
	require.True(t, created)
	second, created, err := directory.Open(tab, PanelLocation{Kind: PanelLocationDocked, WindowName: "app-b", GroupID: "bottom"})
	require.NoError(t, err)
	require.False(t, created)
	require.Equal(t, first, second)
	require.Len(t, directory.Snapshot("production").Panels, 1)
	require.Empty(t, directory.Snapshot("staging").Panels)
}

func TestWorkspaceRetainsDockedPanelsWhenAppWindowCloses(t *testing.T) {
	directory := NewWorkspaceDirectory()
	docked := workspaceTab("production", "api")
	floating := workspaceTab("production", "worker")
	_, _, err := directory.Open(docked, PanelLocation{Kind: PanelLocationDocked, WindowName: "app-a", GroupID: "right"})
	require.NoError(t, err)
	_, _, err = directory.Open(floating, PanelLocation{Kind: PanelLocationWindow, WindowName: "panel-1", GroupID: "group-1"})
	require.NoError(t, err)
	directory.RetainWindow("app-a")
	panels := directory.Snapshot("production").Panels
	require.Len(t, panels, 2)
	require.Equal(t, PanelLocationRetained, panels[0].Location.Kind)
	require.Empty(t, panels[0].Location.WindowName)
	require.Equal(t, "panel-1", panels[1].Location.WindowName)
	reopened, render, err := directory.Open(docked, PanelLocation{Kind: PanelLocationDocked, WindowName: "app-b", GroupID: "bottom"})
	require.NoError(t, err)
	require.True(t, render)
	require.Equal(t, "app-b", reopened.Location.WindowName)
}

func TestWorkspaceWindowRemovalDeletesOnlyThatWindowsPanels(t *testing.T) {
	directory := NewWorkspaceDirectory()
	docked, floating := workspaceTab("production", "api"), workspaceTab("production", "worker")
	_, _, err := directory.Open(docked, PanelLocation{Kind: PanelLocationDocked, WindowName: "app-a", GroupID: "right"})
	require.NoError(t, err)
	_, _, err = directory.Open(floating, PanelLocation{Kind: PanelLocationWindow, WindowName: "panel-1", GroupID: "group-1"})
	require.NoError(t, err)
	directory.RemoveWindow("panel-1")
	panels := directory.Snapshot("production").Panels
	require.Len(t, panels, 1)
	require.Equal(t, docked, panels[0].Tab)
}

func TestWorkspacePublicationPreservesOtherWindowsAndRejectsForeignPanelsAtomically(t *testing.T) {
	directory := NewWorkspaceDirectory()
	prod := workspaceTab("production", "api")
	stage := workspaceTab("staging", "api")
	prodGroup := WorkspaceGroup{ClusterID: "production", GroupID: "right", Tabs: []TabSnapshot{prod}, ActivePanelID: prod.PanelID}
	stageGroup := WorkspaceGroup{ClusterID: "staging", GroupID: "bottom", Tabs: []TabSnapshot{stage}, ActivePanelID: stage.PanelID}
	require.NoError(t, directory.PublishWindow("app-a", PanelLocationDocked, []WorkspaceGroup{prodGroup}))
	require.NoError(t, directory.PublishWindow("app-b", PanelLocationDocked, []WorkspaceGroup{stageGroup}))
	before := directory.Snapshot("production")
	require.Error(t, directory.PublishWindow("app-b", PanelLocationDocked, []WorkspaceGroup{prodGroup}))
	require.Equal(t, before, directory.Snapshot("production"))
	require.Len(t, directory.Snapshot("staging").Panels, 1)
	require.NoError(t, directory.PublishWindow("app-a", PanelLocationDocked, nil))
	require.Empty(t, directory.Snapshot("production").Panels)
	require.Len(t, directory.Snapshot("staging").Panels, 1)
}

func TestWorkspaceClaimSurvivesPublicationBeforePanelMounts(t *testing.T) {
	directory := NewWorkspaceDirectory()
	tab := workspaceTab("production", "api")
	_, _, err := directory.Open(tab, PanelLocation{Kind: PanelLocationDocked, WindowName: "app-a", GroupID: "right"})
	require.NoError(t, err)
	require.NoError(t, directory.PublishWindow("app-a", PanelLocationDocked, nil))
	require.Len(t, directory.Snapshot("production").Panels, 1)
	require.NoError(t, directory.PublishWindow("app-a", PanelLocationDocked, []WorkspaceGroup{{ClusterID: "production", GroupID: "right", Tabs: []TabSnapshot{tab}, ActivePanelID: tab.PanelID}}))
	require.NoError(t, directory.PublishWindow("app-a", PanelLocationDocked, nil))
	require.Empty(t, directory.Snapshot("production").Panels)
}

func TestWorkspaceOpenUsesCompleteObjectIdentityAcrossPanelIDs(t *testing.T) {
	directory := NewWorkspaceDirectory()
	tab := workspaceTab("production", "api")
	first, _, err := directory.Open(tab, PanelLocation{Kind: PanelLocationDocked, WindowName: "app-a", GroupID: "right"})
	require.NoError(t, err)
	tab.PanelID = "another-view-of-api"
	actual, render, err := directory.Open(tab, PanelLocation{Kind: PanelLocationDocked, WindowName: "app-b", GroupID: "right"})
	require.NoError(t, err)
	require.False(t, render)
	require.Equal(t, first, actual)
	tab.ObjectRef.Version = "v2"
	_, render, err = directory.Open(tab, PanelLocation{Kind: PanelLocationDocked, WindowName: "app-b", GroupID: "right"})
	require.NoError(t, err)
	require.True(t, render)
}

func TestClusterViewTransferMovesDockedGroupsAndPreservesFloatingPanels(t *testing.T) {
	directory := NewWorkspaceDirectory()
	source, existing, floating := workspaceTab("production", "source"), workspaceTab("production", "existing"), workspaceTab("production", "floating")
	groups := []WorkspaceGroup{{ClusterID: "production", GroupID: "right", Tabs: []TabSnapshot{source}, ActivePanelID: source.PanelID}}
	require.NoError(t, directory.PublishWindow("app-a", PanelLocationDocked, groups))
	require.NoError(t, directory.PublishWindow("app-b", PanelLocationDocked, []WorkspaceGroup{{ClusterID: "production", GroupID: "right", Tabs: []TabSnapshot{existing}, ActivePanelID: existing.PanelID}}))
	_, _, err := directory.Open(floating, PanelLocation{Kind: PanelLocationWindow, WindowName: "panel-1", GroupID: "floating-1"})
	require.NoError(t, err)
	before := directory.Snapshot("production")
	require.Error(t, directory.TransferClusterView("app-a", "app-b", "production", nil))
	require.Equal(t, before, directory.Snapshot("production"))
	require.NoError(t, directory.TransferClusterView("app-a", "app-b", "production", groups))
	for _, panel := range directory.Snapshot("production").Panels {
		switch panel.Tab.PanelID {
		case source.PanelID:
			require.Equal(t, "app-b", panel.Location.WindowName)
			require.Equal(t, 1, panel.Location.Index)
		case existing.PanelID:
			require.Equal(t, "app-b", panel.Location.WindowName)
			require.Equal(t, 0, panel.Location.Index)
		case floating.PanelID:
			require.Equal(t, "panel-1", panel.Location.WindowName)
		}
	}
}

func TestPublicationRejectsTwoIDsForTheSameObjectAtomically(t *testing.T) {
	directory := NewWorkspaceDirectory()
	first := workspaceTab("production", "api")
	second := first
	second.PanelID = "different-id"
	groups := []WorkspaceGroup{{ClusterID: "production", GroupID: "right", Tabs: []TabSnapshot{first, second}, ActivePanelID: first.PanelID}}
	require.Error(t, directory.PublishWindow("app-a", PanelLocationDocked, groups))
	require.Empty(t, directory.Snapshot("production").Panels)
}
