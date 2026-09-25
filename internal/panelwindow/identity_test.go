package panelwindow

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestIdentityPanelSnapshotsPreserveExactSubjectsWithoutObjectReferences(t *testing.T) {
	tab := TabSnapshot{Kind: "identity", PanelID: "identity-user", ActiveView: "details"}
	require.NoError(t, json.Unmarshal([]byte(`{"kind":"identity","panelId":"identity-user","activeView":"details","identityRef":{"clusterId":"cluster-1","kind":"User","name":" alice "}}`), &tab))
	snapshot := GroupSnapshot{SchemaVersion: GroupSchemaVersion, TransferID: "transfer", SourceWindowName: "workspace", ClusterID: "cluster-1", GroupID: "right", Tabs: []TabSnapshot{tab}, ActivePanelID: tab.PanelID}
	require.NoError(t, ValidateGroupSnapshot(snapshot))
	data, err := json.Marshal(tab)
	require.NoError(t, err)
	require.NotContains(t, string(data), "objectRef")
	require.Contains(t, string(data), `"name":" alice "`)

	for _, input := range []string{
		`{"kind":"identity","identityRef":{"clusterId":"cluster-2","kind":"User","name":"alice"}}`,
		`{"kind":"identity","identityRef":{"clusterId":"cluster-1","kind":"ServiceAccount","name":"alice"}}`,
		`{"kind":"identity","identityRef":{"clusterId":"cluster-1","kind":"User","name":""}}`,
		`{"kind":"identity","identityRef":{"clusterId":"cluster-1","kind":"Group","name":"alice"},"objectRef":{"clusterId":"cluster-1","version":"v1","kind":"Node","name":"node"}}`,
	} {
		invalid := TabSnapshot{PanelID: "identity-user", ActiveView: "details"}
		require.NoError(t, json.Unmarshal([]byte(input), &invalid))
		snapshot.Tabs = []TabSnapshot{invalid}
		require.Error(t, ValidateGroupSnapshot(snapshot))
	}
}

func TestIdentityPanelsShareOwnershipAndTransferWithResourcePanels(t *testing.T) {
	directory := NewWorkspaceDirectory()
	user := TabSnapshot{Kind: TabKindIdentity, PanelID: "identity-user", ActiveView: "details", IdentityRef: IdentityReference{ClusterID: "production", Kind: "User", Name: " alice "}}
	group := user
	group.PanelID = "identity-group"
	group.IdentityRef.Kind = "Group"
	pod := workspaceTab("production", "api")
	source := PanelLocation{Kind: PanelLocationDocked, WindowName: "app-a", GroupID: "right"}
	target := PanelLocation{Kind: PanelLocationWindow, WindowName: "panel-1", GroupID: "group-1"}
	first, created, err := directory.Open(user, source)
	require.NoError(t, err)
	require.True(t, created)
	again, created, err := directory.Open(user, target)
	require.NoError(t, err)
	require.False(t, created)
	require.Equal(t, first, again)
	_, _, err = directory.Open(group, source)
	require.NoError(t, err)
	_, _, err = directory.Open(pod, source)
	require.NoError(t, err)
	require.Len(t, directory.Snapshot("production").Panels, 3)
	require.Empty(t, directory.Snapshot("staging").Panels)
	require.NoError(t, directory.Move(user, source, target))
	require.Error(t, directory.Move(user, source, target))
	altered := user
	altered.IdentityRef.Name = "alice"
	_, _, err = directory.Open(altered, source)
	require.Error(t, err)
	require.NoError(t, directory.Move(user, target, source))
	directory.RetainWindow("app-a")
	reopened, created, err := directory.Open(user, source)
	require.NoError(t, err)
	require.True(t, created)
	require.Equal(t, user, reopened.Tab)
	directory.RemoveWindow("app-a")
	require.Len(t, directory.Snapshot("production").Panels, 2)
	for _, panel := range directory.Snapshot("production").Panels {
		require.NotEqual(t, user.PanelID, panel.Tab.PanelID)
		require.Equal(t, PanelLocationRetained, panel.Location.Kind)
	}

}
