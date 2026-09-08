package panelwindow

import (
	"github.com/stretchr/testify/require"
	"testing"
)

func TestClusterReservationsAreScopedAndRemovalInvalidatesOnlyTheOldGeneration(t *testing.T) {
	directory := NewWorkspaceDirectory()
	first := directory.ReserveCluster("first")
	peer := directory.ReserveCluster("peer")
	require.True(t, first.Live())
	require.True(t, directory.HasClusterReference("first"))
	directory.RemoveCluster("first")
	require.False(t, first.Live())
	require.False(t, directory.HasClusterReference("first"))
	require.True(t, peer.Live())
	replacement := directory.ReserveCluster("first")
	first.Release()
	require.True(t, replacement.Live())
	replacement.Release()
	replacement.Release()
	require.False(t, directory.HasClusterReference("first"))
	peer.Release()
	require.False(t, directory.HasClusterReference("peer"))
}

func TestRemovedReservationCannotCommitAfterEarlierLivenessCheck(t *testing.T) {
	for _, action := range []string{"open", "publish"} {
		t.Run(action, func(t *testing.T) {
			directory := NewWorkspaceDirectory()
			tab := workspaceTab("pod", "cluster-1")
			reservation := directory.ReserveCluster(tab.ObjectRef.ClusterID)
			require.True(t, reservation.Live())
			directory.RemoveCluster(tab.ObjectRef.ClusterID)
			var err error
			if action == "open" {
				_, _, err = directory.Open(tab, PanelLocation{Kind: PanelLocationDocked, WindowName: "app", GroupID: "right"}, reservation)
			} else {
				_, err = directory.PublishWindowWithTransfers("app", PanelLocationDocked, []WorkspaceGroup{{ClusterID: tab.ObjectRef.ClusterID, GroupID: "right", Tabs: []TabSnapshot{tab}, ActivePanelID: tab.PanelID}}, nil, reservation)
			}
			require.Error(t, err)
			require.Empty(t, directory.Snapshot(tab.ObjectRef.ClusterID).Panels)
		})
	}
}
