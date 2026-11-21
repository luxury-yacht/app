package panelwindow

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/require"
)

// A kind panel describes a kind, not an object, so it travels between windows
// and into saved workspaces with the kind's own identity and no object
// reference. A malformed one must not be accepted and later fail to render.
func TestAPIResourcePanelSnapshotsCarryCompleteKindIdentity(t *testing.T) {
	const valid = `{"kind":"api-resource","panelId":"kind-deployments","activeView":"explain","apiResourceRef":{"clusterId":"cluster-1","group":"apps","kind":"Deployment","resource":"deployments"}}`
	var tab TabSnapshot
	require.NoError(t, json.Unmarshal([]byte(valid), &tab))
	snapshot := GroupSnapshot{SchemaVersion: GroupSchemaVersion, TransferID: "transfer", SourceWindowName: "workspace", ClusterID: "cluster-1", GroupID: "right", Tabs: []TabSnapshot{tab}, ActivePanelID: tab.PanelID}
	require.NoError(t, ValidateGroupSnapshot(snapshot))
	require.Equal(t, "cluster-1", tab.ClusterID())
	data, err := json.Marshal(tab)
	require.NoError(t, err)
	require.NotContains(t, string(data), "objectRef")
	require.NotContains(t, string(data), "identityRef")

	// The core group is the empty group.
	core := tab
	core.APIResourceRef = APIResourceReference{ClusterID: "cluster-1", Kind: "Pod", Resource: "pods"}
	core.ActiveView = "details"
	snapshot.Tabs = []TabSnapshot{core}
	require.NoError(t, ValidateGroupSnapshot(snapshot))

	for name, input := range map[string]string{
		"other cluster":               `{"kind":"api-resource","activeView":"details","apiResourceRef":{"clusterId":"cluster-2","group":"apps","kind":"Deployment","resource":"deployments"}}`,
		"no kind":                     `{"kind":"api-resource","activeView":"details","apiResourceRef":{"clusterId":"cluster-1","group":"apps","resource":"deployments"}}`,
		"no resource":                 `{"kind":"api-resource","activeView":"details","apiResourceRef":{"clusterId":"cluster-1","group":"apps","kind":"Deployment"}}`,
		"object reference":            `{"kind":"api-resource","activeView":"details","apiResourceRef":{"clusterId":"cluster-1","group":"apps","kind":"Deployment","resource":"deployments"},"objectRef":{"clusterId":"cluster-1","version":"v1","kind":"Node","name":"node"}}`,
		"object-only view":            `{"kind":"api-resource","activeView":"yaml","apiResourceRef":{"clusterId":"cluster-1","group":"apps","kind":"Deployment","resource":"deployments"}}`,
		"kind ref on an object panel": `{"kind":"object","activeView":"details","objectRef":{"clusterId":"cluster-1","version":"v1","kind":"Node","name":"node"},"apiResourceRef":{"clusterId":"cluster-1","kind":"Pod","resource":"pods"}}`,
	} {
		t.Run(name, func(t *testing.T) {
			invalid := TabSnapshot{PanelID: "kind-deployments"}
			require.NoError(t, json.Unmarshal([]byte(input), &invalid))
			invalidSnapshot := snapshot
			invalidSnapshot.Tabs = []TabSnapshot{invalid}
			require.Error(t, ValidateGroupSnapshot(invalidSnapshot))
		})
	}
}

// Two groups can serve a kind with the same name; their panels are different panels.
func TestAPIResourcePanelsOfDifferentGroupsAreDistinct(t *testing.T) {
	directory := NewWorkspaceDirectory()
	location := PanelLocation{Kind: PanelLocationDocked, WindowName: "app-a", GroupID: "right"}
	certManager := TabSnapshot{Kind: TabKindAPIResource, PanelID: "kind-a", ActiveView: "details",
		APIResourceRef: APIResourceReference{ClusterID: "production", Group: "cert-manager.io", Kind: "Certificate", Resource: "certificates"}}
	other := certManager
	other.APIResourceRef.Group = "example.io"

	_, created, err := directory.Open(certManager, location)
	require.NoError(t, err)
	require.True(t, created)
	_, created, err = directory.Open(certManager, location)
	require.NoError(t, err)
	require.False(t, created, "the same kind reuses its panel")
	_, _, err = directory.Open(other, location)
	require.Error(t, err, "a panel id cannot be retargeted to another kind")
}

// A kind panel is identified by what its panel ID encodes: cluster, group and
// plural resource. The version a kind is read at is not part of the reference
// (the panel reads the current one), and the kind name is a label, so neither
// can make the directory refuse to reopen a panel that is already open.
func TestAPIResourcePanelReopensWhateverItsLabelSays(t *testing.T) {
	directory := NewWorkspaceDirectory()
	location := PanelLocation{Kind: PanelLocationDocked, WindowName: "app-a", GroupID: "right"}
	widgets := TabSnapshot{Kind: TabKindAPIResource, PanelID: "kind-widgets", ActiveView: "details",
		APIResourceRef: APIResourceReference{ClusterID: "production", Group: "example.io", Kind: "Widget", Resource: "widgets"}}
	_, _, err := directory.Open(widgets, location)
	require.NoError(t, err)

	relabelled := widgets
	relabelled.APIResourceRef.Kind = "Gizmo"
	relabelled.ActiveView = "explain"
	_, created, err := directory.Open(relabelled, location)

	require.NoError(t, err)
	require.False(t, created)
	require.True(t, widgets.SameIdentity(relabelled))

	// A reference saved while it still carried a version decodes to the same panel.
	var saved TabSnapshot
	require.NoError(t, json.Unmarshal([]byte(`{"kind":"api-resource","panelId":"kind-widgets","activeView":"details","apiResourceRef":{"clusterId":"production","group":"example.io","version":"v1","kind":"Widget","resource":"widgets"}}`), &saved))
	require.True(t, widgets.SameIdentity(saved))
}
