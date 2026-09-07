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

func TestWorkspaceMoveChangesPlacementOnlyAndRejectsStaleSource(t *testing.T) {
	directory := NewWorkspaceDirectory()
	tab := workspaceTab("production", "api")
	source := PanelLocation{Kind: PanelLocationDocked, WindowName: "app-a", GroupID: "right"}
	target := PanelLocation{Kind: PanelLocationWindow, WindowName: "panel-1", GroupID: "group-1"}
	_, _, err := directory.Open(tab, source)
	require.NoError(t, err)
	require.NoError(t, directory.Move(tab, source, target))
	require.Error(t, directory.Move(tab, source, PanelLocation{Kind: PanelLocationDocked, WindowName: "app-b", GroupID: "right"}))
	require.Equal(t, WorkspacePanel{Tab: tab, Location: target}, directory.Snapshot("production").Panels[0])
	directory.RemoveWindow("app-a")
	require.Len(t, directory.Snapshot("production").Panels, 1)
	directory.RemoveWindow("panel-1")
	require.Empty(t, directory.Snapshot("production").Panels)
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

func TestWorkspaceGroupTransferValidatesEveryTabBeforeMovingAny(t *testing.T) {
	directory := NewWorkspaceDirectory()
	first, second := workspaceTab("production", "first"), workspaceTab("production", "second")
	_, _, err := directory.Open(first, PanelLocation{Kind: PanelLocationDocked, WindowName: "app-a", GroupID: "right"})
	require.NoError(t, err)
	_, _, err = directory.Open(second, PanelLocation{Kind: PanelLocationDocked, WindowName: "app-b", GroupID: "right"})
	require.NoError(t, err)
	group := WorkspaceGroup{ClusterID: "production", GroupID: "native-group", Tabs: []TabSnapshot{first, second}, ActivePanelID: first.PanelID}
	before := directory.Snapshot("production")
	require.Error(t, directory.TransferGroup("app-a", "panel-1", PanelLocationWindow, group))
	require.Equal(t, before, directory.Snapshot("production"))
	group.Tabs = []TabSnapshot{first}
	require.NoError(t, directory.TransferGroup("app-a", "panel-1", PanelLocationWindow, group))
	require.Equal(t, "panel-1", directory.Snapshot("production").Panels[0].Location.WindowName)
	require.Error(t, directory.TransferGroup("app-a", "panel-2", PanelLocationWindow, group))
}

func TestWorkspacePublicationAndTabTransferCommitAtomically(t *testing.T) {
	directory := NewWorkspaceDirectory()
	source, target, foreign := workspaceTab("production", "source"), workspaceTab("production", "target"), workspaceTab("production", "foreign")
	for window, tab := range map[string]TabSnapshot{"app-a": source, "app-b": target, "app-c": foreign} {
		require.NoError(t, directory.PublishWindow(window, PanelLocationDocked, []WorkspaceGroup{{ClusterID: "production", GroupID: "right", Tabs: []TabSnapshot{tab}, ActivePanelID: tab.PanelID}}))
	}
	transfer := PlacementTransfer{TransferID: "move-1", Tab: source, SourceWindowName: "app-a", SourceGroupID: "right", TargetGroupID: "bottom"}
	group := WorkspaceGroup{ClusterID: "production", GroupID: "bottom", Tabs: []TabSnapshot{target, source, foreign}, ActivePanelID: source.PanelID}
	before := directory.Snapshot("production")
	_, err := directory.PublishWindowWithTransfers("app-b", PanelLocationDocked, []WorkspaceGroup{group}, []PlacementTransfer{transfer})
	require.Error(t, err)
	require.Equal(t, before, directory.Snapshot("production"))
	group.Tabs = []TabSnapshot{target, source}
	committed, err := directory.PublishWindowWithTransfers("app-b", PanelLocationDocked, []WorkspaceGroup{group}, []PlacementTransfer{transfer})
	require.NoError(t, err)
	require.Equal(t, []string{"move-1"}, committed)
	for _, panel := range directory.Snapshot("production").Panels {
		if panel.Tab.PanelID == source.PanelID {
			require.Equal(t, PanelLocation{Kind: PanelLocationDocked, WindowName: "app-b", GroupID: "bottom", Index: 1, Active: true}, panel.Location)
		}
	}
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

func TestWorkspacePublicationRejectsMissingTransferSource(t *testing.T) {
	directory := NewWorkspaceDirectory()
	tab := workspaceTab("production", "api")
	transfer := PlacementTransfer{TransferID: "move-1", Tab: tab, SourceWindowName: "app-a", SourceGroupID: "right", TargetGroupID: "bottom"}
	before := directory.Snapshot("production")
	_, err := directory.PublishWindowWithTransfers("app-b", PanelLocationDocked, []WorkspaceGroup{{ClusterID: "production", GroupID: "bottom", Tabs: []TabSnapshot{tab}, ActivePanelID: tab.PanelID}}, []PlacementTransfer{transfer})
	require.Error(t, err)
	require.Equal(t, before, directory.Snapshot("production"))
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

func TestDockedGroupTransferAppendsWithoutDuplicatingTheActiveTab(t *testing.T) {
	directory := NewWorkspaceDirectory()
	source, existing := workspaceTab("production", "source"), workspaceTab("production", "existing")
	_, _, err := directory.Open(source, PanelLocation{Kind: PanelLocationWindow, WindowName: "panel-1", GroupID: "floating", Active: true})
	require.NoError(t, err)
	_, _, err = directory.Open(existing, PanelLocation{Kind: PanelLocationDocked, WindowName: "app-a", GroupID: "right", Active: true})
	require.NoError(t, err)
	require.NoError(t, directory.TransferGroup("panel-1", "app-a", PanelLocationDocked, WorkspaceGroup{ClusterID: "production", GroupID: "right", Tabs: []TabSnapshot{source}, ActivePanelID: source.PanelID}))
	for _, panel := range directory.Snapshot("production").Panels {
		if panel.Tab.PanelID == source.PanelID {
			require.Equal(t, 1, panel.Location.Index)
			require.True(t, panel.Location.Active)
		}
		if panel.Tab.PanelID == existing.PanelID {
			require.False(t, panel.Location.Active)
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
