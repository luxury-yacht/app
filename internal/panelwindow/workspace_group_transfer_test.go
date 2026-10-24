package panelwindow

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func openDocked(t *testing.T, directory *WorkspaceDirectory, window string, tabs ...TabSnapshot) {
	t.Helper()
	for _, tab := range tabs {
		_, _, err := directory.Open(tab, PanelLocation{Kind: PanelLocationDocked, WindowName: window, GroupID: "right"})
		require.NoError(t, err)
	}
	require.NoError(t, directory.PublishWindow(window, PanelLocationDocked, []WorkspaceGroup{{ClusterID: tabs[0].ClusterID(), GroupID: "right", Tabs: tabs, ActivePanelID: tabs[0].PanelID}}))
}

// moveTab moves one tab through the directory's only cross-window writer.
func moveTab(directory *WorkspaceDirectory, id string, tab TabSnapshot, source string, target PanelLocation) error {
	if err := directory.BeginGroupTransfer(GroupTransfer{
		TransferID:   id,
		SourceWindow: source,
		Target:       target,
		Group:        WorkspaceGroup{ClusterID: tab.ClusterID(), Tabs: []TabSnapshot{tab}, ActivePanelID: tab.PanelID},
	}); err != nil {
		return err
	}
	return directory.CommitGroupTransfer(id)
}

func floatTransfer(id, source string, tabs ...TabSnapshot) GroupTransfer {
	return GroupTransfer{
		TransferID:   id,
		SourceWindow: source,
		Target:       PanelLocation{Kind: PanelLocationWindow, WindowName: "panel-1", GroupID: "native-group"},
		Group:        WorkspaceGroup{ClusterID: tabs[0].ClusterID(), Tabs: tabs, ActivePanelID: tabs[len(tabs)-1].PanelID},
	}
}

func panelsByID(directory *WorkspaceDirectory, clusterID string) map[string]WorkspacePanel {
	panels := make(map[string]WorkspacePanel)
	for _, panel := range directory.Snapshot(clusterID).Panels {
		panels[panel.Tab.PanelID] = panel
	}
	return panels
}

func TestGroupTransferKeepsSourcePlacementUntilCommit(t *testing.T) {
	directory := NewWorkspaceDirectory()
	first, second := workspaceTab("production", "first"), workspaceTab("production", "second")
	openDocked(t, directory, "app-a", first, second)
	yamlView := second
	yamlView.ActiveView = "yaml"

	require.NoError(t, directory.BeginGroupTransfer(floatTransfer("float-1", "app-a", first, yamlView)))

	pending := panelsByID(directory, "production")
	require.Len(t, pending, 2, "a pending transfer must not duplicate panels in a read")
	for _, panel := range pending {
		require.Equal(t, "app-a", panel.Location.WindowName, "source keeps placement until commit")
		require.NotZero(t, panel.Transfer)
		require.Equal(t, "float-1", panel.Transfer.TransferID)
		require.Equal(t, "panel-1", panel.Transfer.Target.WindowName)
	}
	require.Equal(t, "yaml", pending[second.PanelID].Tab.ActiveView, "the intent carries view state")

	require.NoError(t, directory.CommitGroupTransfer("float-1"))
	committed := panelsByID(directory, "production")
	require.Equal(t, PanelLocation{Kind: PanelLocationWindow, WindowName: "panel-1", GroupID: "native-group", Index: 0}, committed[first.PanelID].Location)
	require.Equal(t, PanelLocation{Kind: PanelLocationWindow, WindowName: "panel-1", GroupID: "native-group", Index: 1, Active: true}, committed[second.PanelID].Location)
	require.Zero(t, committed[first.PanelID].Transfer)
	require.Error(t, directory.CommitGroupTransfer("float-1"), "a transfer commits once")
}

func TestCancelledGroupTransferKeepsSourceAndReleasesPanels(t *testing.T) {
	directory := NewWorkspaceDirectory()
	tab := workspaceTab("production", "api")
	openDocked(t, directory, "app-a", tab)
	before := directory.Snapshot("production").Panels

	require.NoError(t, directory.BeginGroupTransfer(floatTransfer("float-1", "app-a", tab)))
	require.True(t, directory.CancelGroupTransfer("float-1"))
	require.False(t, directory.CancelGroupTransfer("float-1"))
	require.Error(t, directory.CommitGroupTransfer("float-1"))

	require.Equal(t, before, directory.Snapshot("production").Panels)
	require.True(t, directory.ClosePanel("app-a", "production", tab.PanelID), "a cancelled transfer must not pin its panels")
}

func TestStaleSourcePublicationsCannotMoveDeleteOrDuplicateAFloatingGroup(t *testing.T) {
	directory := NewWorkspaceDirectory()
	moving, staying := workspaceTab("production", "moving"), workspaceTab("production", "staying")
	openDocked(t, directory, "app-a", moving, staying)
	require.NoError(t, directory.BeginGroupTransfer(floatTransfer("float-1", "app-a", moving)))

	// Source snapshots queued around the intent: one moves the pending tab to
	// another edge, a later one omits it. Neither may change its placement.
	require.NoError(t, directory.PublishWindow("app-a", PanelLocationDocked, []WorkspaceGroup{{ClusterID: "production", GroupID: "bottom", Tabs: []TabSnapshot{staying, moving}, ActivePanelID: staying.PanelID}}))
	require.NoError(t, directory.PublishWindow("app-a", PanelLocationDocked, []WorkspaceGroup{{ClusterID: "production", GroupID: "bottom", Tabs: []TabSnapshot{staying}, ActivePanelID: staying.PanelID}}))
	// A renderer outside the transfer still cannot claim the panel.
	require.NoError(t, directory.PublishWindow("app-b", PanelLocationDocked, []WorkspaceGroup{{ClusterID: "production", GroupID: "right", Tabs: []TabSnapshot{moving}, ActivePanelID: moving.PanelID}}))

	pending := panelsByID(directory, "production")
	require.Len(t, pending, 2)
	require.Equal(t, PanelLocation{Kind: PanelLocationDocked, WindowName: "app-a", GroupID: "right", Index: 0, Active: true}, pending[moving.PanelID].Location)
	require.Equal(t, "bottom", pending[staying.PanelID].Location.GroupID, "non-pending tabs still publish")

	require.NoError(t, directory.CommitGroupTransfer("float-1"))
	// The source's pre-intent snapshot arrives after commit: it must not steal
	// the floated tab back or create a second copy.
	require.NoError(t, directory.PublishWindow("app-a", PanelLocationDocked, []WorkspaceGroup{{ClusterID: "production", GroupID: "bottom", Tabs: []TabSnapshot{staying, moving}, ActivePanelID: staying.PanelID}}))
	committed := panelsByID(directory, "production")
	require.Len(t, committed, 2)
	require.Equal(t, "panel-1", committed[moving.PanelID].Location.WindowName)
}

func TestDockTargetPublicationCannotClaimItsProvisionalCopyBeforeCommit(t *testing.T) {
	directory := NewWorkspaceDirectory()
	moving, existing := workspaceTab("production", "moving"), workspaceTab("production", "existing")
	_, _, err := directory.Open(moving, PanelLocation{Kind: PanelLocationWindow, WindowName: "panel-1", GroupID: "floating", Active: true})
	require.NoError(t, err)
	openDocked(t, directory, "app-a", existing)
	require.NoError(t, directory.BeginGroupTransfer(GroupTransfer{
		TransferID:   "dock-1",
		SourceWindow: "panel-1",
		Target:       PanelLocation{Kind: PanelLocationDocked, WindowName: "app-a", GroupID: "right"},
		Group:        WorkspaceGroup{ClusterID: "production", Tabs: []TabSnapshot{moving}, ActivePanelID: moving.PanelID},
	}))

	// The target mounts the incoming tab and publishes its whole dock.
	require.NoError(t, directory.PublishWindow("app-a", PanelLocationDocked, []WorkspaceGroup{{ClusterID: "production", GroupID: "right", Tabs: []TabSnapshot{existing, moving}, ActivePanelID: moving.PanelID}}))
	require.Equal(t, "panel-1", panelsByID(directory, "production")[moving.PanelID].Location.WindowName)

	require.True(t, directory.CancelGroupTransfer("dock-1"))
	panels := panelsByID(directory, "production")
	require.Len(t, panels, 2)
	require.Equal(t, "panel-1", panels[moving.PanelID].Location.WindowName, "a cancelled dock keeps the native source")
}

func TestGroupTransferRejectsStaleSourceAndOverlappingTransferAtomically(t *testing.T) {
	directory := NewWorkspaceDirectory()
	first, second := workspaceTab("production", "first"), workspaceTab("production", "second")
	openDocked(t, directory, "app-a", first)
	openDocked(t, directory, "app-b", second)
	before := directory.Snapshot("production")

	require.Error(t, directory.BeginGroupTransfer(floatTransfer("float-1", "app-a", first, second)), "every tab must be in the source window")
	require.Equal(t, before, directory.Snapshot("production"))
	renamed := first
	renamed.ObjectRef.Name = "another-object"
	require.Error(t, directory.BeginGroupTransfer(floatTransfer("float-2", "app-a", renamed)), "panel identity must match the directory")

	require.NoError(t, directory.BeginGroupTransfer(floatTransfer("float-3", "app-a", first)))
	require.Error(t, directory.BeginGroupTransfer(floatTransfer("float-4", "app-a", first)), "a pending panel cannot join a second transfer")
	require.Error(t, directory.BeginGroupTransfer(floatTransfer("float-3", "app-b", second)), "transfer IDs are unique")
}

func TestDockedGroupCommitAppendsAfterExistingTabsAndMovesActivation(t *testing.T) {
	directory := NewWorkspaceDirectory()
	source, existing := workspaceTab("production", "source"), workspaceTab("production", "existing")
	_, _, err := directory.Open(source, PanelLocation{Kind: PanelLocationWindow, WindowName: "panel-1", GroupID: "floating", Active: true})
	require.NoError(t, err)
	openDocked(t, directory, "app-a", existing)

	require.NoError(t, directory.BeginGroupTransfer(GroupTransfer{
		TransferID:   "dock-1",
		SourceWindow: "panel-1",
		Target:       PanelLocation{Kind: PanelLocationDocked, WindowName: "app-a", GroupID: "right", Index: AppendToGroup},
		Group:        WorkspaceGroup{ClusterID: "production", Tabs: []TabSnapshot{source}, ActivePanelID: source.PanelID},
	}))
	require.NoError(t, directory.CommitGroupTransfer("dock-1"))

	panels := panelsByID(directory, "production")
	require.Equal(t, PanelLocation{Kind: PanelLocationDocked, WindowName: "app-a", GroupID: "right", Index: 1, Active: true}, panels[source.PanelID].Location)
	require.False(t, panels[existing.PanelID].Location.Active)
}

func TestSingleTabTransferLandsAtTheDropIndex(t *testing.T) {
	directory := NewWorkspaceDirectory()
	first, second, moving := workspaceTab("production", "first"), workspaceTab("production", "second"), workspaceTab("production", "moving")
	openDocked(t, directory, "app-a", first, second)
	_, _, err := directory.Open(moving, PanelLocation{Kind: PanelLocationWindow, WindowName: "panel-1", GroupID: "floating", Active: true})
	require.NoError(t, err)

	require.NoError(t, directory.BeginGroupTransfer(GroupTransfer{
		TransferID:   "drop-1",
		SourceWindow: "panel-1",
		Target:       PanelLocation{Kind: PanelLocationDocked, WindowName: "app-a", GroupID: "right", Index: 1},
		Group:        WorkspaceGroup{ClusterID: "production", Tabs: []TabSnapshot{moving}, ActivePanelID: moving.PanelID},
	}))
	require.Equal(t, 1, panelsByID(directory, "production")[moving.PanelID].Transfer.Target.Index, "the target mounts its copy where it was dropped")
	require.NoError(t, directory.CommitGroupTransfer("drop-1"))

	panels := panelsByID(directory, "production")
	require.Equal(t, PanelLocation{Kind: PanelLocationDocked, WindowName: "app-a", GroupID: "right", Index: 1, Active: true}, panels[moving.PanelID].Location)
	require.Equal(t, PanelLocation{Kind: PanelLocationDocked, WindowName: "app-a", GroupID: "right", Index: 0}, panels[first.PanelID].Location)
	require.Equal(t, PanelLocation{Kind: PanelLocationDocked, WindowName: "app-a", GroupID: "right", Index: 2}, panels[second.PanelID].Location)
}

func TestRemovedPanelsLeaveTheirPendingTransfer(t *testing.T) {
	directory := NewWorkspaceDirectory()
	tab := workspaceTab("production", "api")
	openDocked(t, directory, "app-a", tab)
	require.NoError(t, directory.BeginGroupTransfer(floatTransfer("float-1", "app-a", tab)))

	directory.RemoveCluster("production")

	require.Empty(t, directory.Snapshot("production").Panels)
	require.Error(t, directory.CommitGroupTransfer("float-1"), "a removed panel cannot be recreated by commit")
	require.False(t, directory.CancelGroupTransfer("float-1"))
}

func TestOpenCannotReclaimARetainedPanelWhileItIsMoving(t *testing.T) {
	directory := NewWorkspaceDirectory()
	tab := workspaceTab("production", "api")
	openDocked(t, directory, "app-a", tab)
	require.NoError(t, directory.BeginGroupTransfer(floatTransfer("float-1", "app-a", tab)))
	directory.RetainWindow("app-a")

	panel, render, err := directory.Open(tab, PanelLocation{Kind: PanelLocationDocked, WindowName: "app-b", GroupID: "right"})
	require.NoError(t, err)
	require.False(t, render, "a moving panel stays with its transfer")
	require.NotZero(t, panel.Transfer)

	require.NoError(t, directory.CommitGroupTransfer("float-1"))
	require.Equal(t, "panel-1", panelsByID(directory, "production")[tab.PanelID].Location.WindowName)
}

func TestViewTransferMovesEveryDockedPanelOfTheClusterAndAppends(t *testing.T) {
	directory := NewWorkspaceDirectory()
	first, second, bottom := workspaceTab("production", "first"), workspaceTab("production", "second"), workspaceTab("production", "bottom")
	existing, floating, otherCluster := workspaceTab("production", "existing"), workspaceTab("production", "floating"), workspaceTab("staging", "first")
	for tab, location := range map[TabSnapshot]PanelLocation{
		first:        {Kind: PanelLocationDocked, WindowName: "app-a", GroupID: "right", Index: 0},
		second:       {Kind: PanelLocationDocked, WindowName: "app-a", GroupID: "right", Index: 1, Active: true},
		otherCluster: {Kind: PanelLocationDocked, WindowName: "app-a", GroupID: "right", Active: true},
		bottom:       {Kind: PanelLocationDocked, WindowName: "app-a", GroupID: "bottom", Active: true},
		floating:     {Kind: PanelLocationWindow, WindowName: "panel-1", GroupID: "native"},
	} {
		_, _, err := directory.Open(tab, location)
		require.NoError(t, err)
	}
	openDocked(t, directory, "app-b", existing)

	groups, err := directory.BeginViewTransfer("view-1", "app-a", "app-b", "production")
	require.NoError(t, err)
	require.ElementsMatch(t, []WorkspaceGroup{
		{ClusterID: "production", GroupID: "right", Tabs: []TabSnapshot{first, second}, ActivePanelID: second.PanelID},
		{ClusterID: "production", GroupID: "bottom", Tabs: []TabSnapshot{bottom}, ActivePanelID: bottom.PanelID},
	}, groups)
	pending := panelsByID(directory, "production")
	require.True(t, pending[first.PanelID].Transfer.View)
	require.Equal(t, "app-a", pending[first.PanelID].Location.WindowName, "the source keeps the view until commit")
	require.Zero(t, pending[floating.PanelID].Transfer)
	require.Zero(t, panelsByID(directory, "staging")[otherCluster.PanelID].Transfer)
	// The source's late snapshot without the moving tabs cannot delete them.
	require.NoError(t, directory.PublishWindow("app-a", PanelLocationDocked, []WorkspaceGroup{{ClusterID: "staging", GroupID: "right", Tabs: []TabSnapshot{otherCluster}, ActivePanelID: otherCluster.PanelID}}))
	require.Len(t, panelsByID(directory, "production"), 5)

	require.NoError(t, directory.CommitGroupTransfer("view-1"))
	committed := panelsByID(directory, "production")
	require.Equal(t, PanelLocation{Kind: PanelLocationDocked, WindowName: "app-b", GroupID: "right", Index: 0}, committed[existing.PanelID].Location)
	require.Equal(t, PanelLocation{Kind: PanelLocationDocked, WindowName: "app-b", GroupID: "right", Index: 1}, committed[first.PanelID].Location)
	require.Equal(t, PanelLocation{Kind: PanelLocationDocked, WindowName: "app-b", GroupID: "right", Index: 2, Active: true}, committed[second.PanelID].Location)
	require.Equal(t, PanelLocation{Kind: PanelLocationDocked, WindowName: "app-b", GroupID: "bottom", Index: 0, Active: true}, committed[bottom.PanelID].Location)
	require.Equal(t, "panel-1", committed[floating.PanelID].Location.WindowName)
	require.Equal(t, "app-a", panelsByID(directory, "staging")[otherCluster.PanelID].Location.WindowName)
}

func TestEmptyViewTransferSettlesWithoutPanels(t *testing.T) {
	directory := NewWorkspaceDirectory()
	groups, err := directory.BeginViewTransfer("view-empty", "app-a", "app-b", "production")
	require.NoError(t, err)
	require.Empty(t, groups)
	require.NoError(t, directory.CommitGroupTransfer("view-empty"))

	_, err = directory.BeginViewTransfer("view-cancelled", "app-a", "app-b", "production")
	require.NoError(t, err)
	require.True(t, directory.CancelGroupTransfer("view-cancelled"))
	require.Error(t, directory.CommitGroupTransfer("view-cancelled"))
}

func TestViewTransferRejectsAViewWhosePanelIsAlreadyMoving(t *testing.T) {
	directory := NewWorkspaceDirectory()
	tab := workspaceTab("production", "api")
	openDocked(t, directory, "app-a", tab)
	require.NoError(t, directory.BeginGroupTransfer(floatTransfer("float-1", "app-a", tab)))

	_, err := directory.BeginViewTransfer("view-1", "app-a", "app-b", "production")
	require.Error(t, err)
	require.Error(t, directory.CommitGroupTransfer("view-1"))
	require.Equal(t, "float-1", panelsByID(directory, "production")[tab.PanelID].Transfer.TransferID)
}

func TestClosePanelRemovesOnlyASettledPanelOfTheCallersWindow(t *testing.T) {
	directory := NewWorkspaceDirectory()
	var removed []PanelKey
	directory.SetPanelRemovalHandler(func(keys []PanelKey) { removed = append(removed, keys...) })
	mine, elsewhere, moving := workspaceTab("production", "mine"), workspaceTab("production", "elsewhere"), workspaceTab("production", "moving")
	openDocked(t, directory, "app-a", mine, moving)
	openDocked(t, directory, "app-b", elsewhere)
	require.NoError(t, directory.BeginGroupTransfer(floatTransfer("float-1", "app-a", moving)))

	require.False(t, directory.ClosePanel("app-a", "production", elsewhere.PanelID), "another window's panel")
	require.False(t, directory.ClosePanel("app-a", "production", moving.PanelID), "a panel the directory is moving")
	require.False(t, directory.ClosePanel("app-a", "production", "missing"))
	require.True(t, directory.ClosePanel("app-a", "production", mine.PanelID))

	require.Equal(t, []PanelKey{{ClusterID: "production", PanelID: mine.PanelID}}, removed)
	require.Len(t, directory.Snapshot("production").Panels, 2)
}

func TestPublicationReportsArrangementOnly(t *testing.T) {
	directory := NewWorkspaceDirectory()
	var removed []PanelKey
	directory.SetPanelRemovalHandler(func(keys []PanelKey) { removed = append(removed, keys...) })
	first, second, foreign := workspaceTab("production", "first"), workspaceTab("production", "second"), workspaceTab("production", "foreign")
	unknown := workspaceTab("production", "unknown")
	openDocked(t, directory, "app-a", first, second)
	openDocked(t, directory, "app-b", foreign)
	yaml := first
	yaml.ActiveView = "yaml"

	// Reorder onto the other edge, change a view, omit a tab, mention another
	// window's panel and one the directory never opened.
	require.NoError(t, directory.PublishWindow("app-a", PanelLocationDocked, []WorkspaceGroup{{ClusterID: "production", GroupID: "bottom", Tabs: []TabSnapshot{foreign, unknown, yaml}, ActivePanelID: yaml.PanelID}}))

	panels := panelsByID(directory, "production")
	require.Equal(t, PanelLocation{Kind: PanelLocationDocked, WindowName: "app-a", GroupID: "bottom", Index: 2, Active: true}, panels[first.PanelID].Location)
	require.Equal(t, "yaml", panels[first.PanelID].Tab.ActiveView)
	require.Equal(t, "app-a", panels[second.PanelID].Location.WindowName, "an omitted tab is not closed")
	require.Equal(t, "app-b", panels[foreign.PanelID].Location.WindowName, "another window's panel is not claimed")
	require.NotContains(t, panels, unknown.PanelID, "a publication does not open panels")
	require.Empty(t, removed)
}
