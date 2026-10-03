package panelwindow

import (
	"testing"

	"github.com/stretchr/testify/require"
)

// Owners of panel-lifetime state (such as the panel metrics buffer) drop it when the directory
// reports the panel closed, and must keep it while the panel only moves.
func TestWorkspaceReportsClosedPanelsButNotMovedOnes(t *testing.T) {
	directory := NewWorkspaceDirectory()
	var removed []PanelKey
	directory.SetPanelRemovalHandler(func(keys []PanelKey) { removed = append(removed, keys...) })
	api := workspaceTab("production", "api")
	worker := workspaceTab("production", "worker")
	docked := PanelLocation{Kind: PanelLocationDocked, WindowName: "app-a", GroupID: "right"}
	native := PanelLocation{Kind: PanelLocationWindow, WindowName: "panel-1", GroupID: "group-1"}
	_, _, err := directory.Open(api, docked)
	require.NoError(t, err)
	_, _, err = directory.Open(worker, docked)
	require.NoError(t, err)
	require.True(t, directory.HasPanel("production", api.PanelID))
	require.False(t, directory.HasPanel("staging", api.PanelID))

	// The panel floats into a native window; the app window republishes without it.
	require.NoError(t, directory.Move(api, docked, native))
	require.NoError(t, directory.PublishWindow("app-a", PanelLocationDocked, []WorkspaceGroup{
		{ClusterID: "production", GroupID: "right", Tabs: []TabSnapshot{worker}, ActivePanelID: worker.PanelID},
	}))
	// Closing the app window keeps its docked panels for another window to reclaim.
	directory.RetainWindow("app-a")
	require.Empty(t, removed)
	require.True(t, directory.HasPanel("production", api.PanelID))

	// Closing the native window closes its panel.
	directory.RemoveWindow("panel-1")
	require.Equal(t, []PanelKey{{ClusterID: "production", PanelID: api.PanelID}}, removed)
	require.False(t, directory.HasPanel("production", api.PanelID))
}

func TestWorkspaceReportsATabClosedByRepublishing(t *testing.T) {
	directory := NewWorkspaceDirectory()
	var removed []PanelKey
	directory.SetPanelRemovalHandler(func(keys []PanelKey) { removed = append(removed, keys...) })
	api := workspaceTab("production", "api")
	worker := workspaceTab("production", "worker")
	group := func(tabs ...TabSnapshot) []WorkspaceGroup {
		return []WorkspaceGroup{{ClusterID: "production", GroupID: "right", Tabs: tabs, ActivePanelID: tabs[0].PanelID}}
	}
	require.NoError(t, directory.PublishWindow("app-a", PanelLocationDocked, group(api, worker)))
	// Republishing the same panels (reordered) closes nothing.
	require.NoError(t, directory.PublishWindow("app-a", PanelLocationDocked, group(worker, api)))
	require.Empty(t, removed)

	require.NoError(t, directory.PublishWindow("app-a", PanelLocationDocked, group(worker)))
	require.Equal(t, []PanelKey{{ClusterID: "production", PanelID: api.PanelID}}, removed)
}

func TestWorkspaceReportsPanelsOfARemovedCluster(t *testing.T) {
	directory := NewWorkspaceDirectory()
	var removed []PanelKey
	directory.SetPanelRemovalHandler(func(keys []PanelKey) { removed = append(removed, keys...) })
	production := workspaceTab("production", "api")
	staging := workspaceTab("staging", "api")
	_, _, err := directory.Open(production, PanelLocation{Kind: PanelLocationDocked, WindowName: "app-a", GroupID: "right"})
	require.NoError(t, err)
	_, _, err = directory.Open(staging, PanelLocation{Kind: PanelLocationDocked, WindowName: "app-a", GroupID: "right"})
	require.NoError(t, err)

	directory.RemoveCluster("production")

	require.Equal(t, []PanelKey{{ClusterID: "production", PanelID: production.PanelID}}, removed)
	require.True(t, directory.HasPanel("staging", staging.PanelID))
}
