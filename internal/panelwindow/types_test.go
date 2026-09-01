package panelwindow

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestValidateGroupSnapshotEnforcesBoundaryIdentity(t *testing.T) {
	valid := GroupSnapshot{
		SchemaVersion:   GroupSchemaVersion,
		TransferID:      "transfer-1",
		OwnerWindowName: "workspace-1",
		ClusterID:       "cluster-1",
		GroupID:         "group-1",
		Tabs: []TabSnapshot{{
			Kind: TabKindObject, PanelID: "panel-1", ActiveView: "details",
			ObjectRef: ObjectReference{
				ClusterID: "cluster-1", Group: "apps", Version: "v1", Kind: "Deployment",
				Namespace: "default", Name: "api",
			},
		}},
		ActivePanelID: "panel-1",
		InitialBounds: &WindowBounds{X: 10, Y: 20, Width: 700, Height: 500},
	}
	require.NoError(t, ValidateGroupSnapshot(valid))

	invalidBounds := valid
	invalidBounds.InitialBounds = &WindowBounds{Width: 0, Height: 500}
	require.ErrorContains(t, ValidateGroupSnapshot(invalidBounds), "positive")

	wrongCluster := valid
	wrongCluster.Tabs = append([]TabSnapshot(nil), valid.Tabs...)
	wrongCluster.Tabs[0].ObjectRef.ClusterID = "cluster-2"
	require.ErrorContains(t, ValidateGroupSnapshot(wrongCluster), "not group cluster")
}

func TestValidateObjectReferenceAcceptsCoreAndClusterScopedObjects(t *testing.T) {
	require.NoError(t, ValidateObjectReference(ObjectReference{
		ClusterID: "cluster-1", Group: "", Version: "v1", Kind: "Node", Namespace: "", Name: "worker-1",
	}))
	require.Error(t, ValidateObjectReference(ObjectReference{ClusterID: "cluster-1"}))
}

func TestValidateGroupSnapshotRejectsEveryInvalidBoundaryShape(t *testing.T) {
	valid := GroupSnapshot{
		SchemaVersion:   GroupSchemaVersion,
		TransferID:      "transfer-1",
		OwnerWindowName: "workspace-1",
		ClusterID:       "cluster-1",
		GroupID:         "group-1",
		Tabs: []TabSnapshot{{
			Kind: TabKindObject, PanelID: "panel-1", ActiveView: "details",
			ObjectRef: ObjectReference{
				ClusterID: "cluster-1", Version: "v1", Kind: "Pod", Namespace: "default", Name: "api",
			},
		}},
		ActivePanelID: "panel-1",
	}

	tests := map[string]func(*GroupSnapshot){
		"schema":        func(g *GroupSnapshot) { g.SchemaVersion = 99 },
		"transfer":      func(g *GroupSnapshot) { g.TransferID = " " },
		"owner":         func(g *GroupSnapshot) { g.OwnerWindowName = "" },
		"cluster":       func(g *GroupSnapshot) { g.ClusterID = "" },
		"group":         func(g *GroupSnapshot) { g.GroupID = "" },
		"empty tabs":    func(g *GroupSnapshot) { g.Tabs = nil },
		"tab kind":      func(g *GroupSnapshot) { g.Tabs[0].Kind = "logs" },
		"panel id":      func(g *GroupSnapshot) { g.Tabs[0].PanelID = "" },
		"active view":   func(g *GroupSnapshot) { g.Tabs[0].ActiveView = "" },
		"object ref":    func(g *GroupSnapshot) { g.Tabs[0].ObjectRef.Name = "" },
		"active absent": func(g *GroupSnapshot) { g.ActivePanelID = "panel-2" },
		"duplicate": func(g *GroupSnapshot) {
			g.Tabs = append(g.Tabs, g.Tabs[0])
		},
	}

	for name, mutate := range tests {
		t.Run(name, func(t *testing.T) {
			snapshot := valid
			snapshot.Tabs = append([]TabSnapshot(nil), valid.Tabs...)
			mutate(&snapshot)
			require.Error(t, ValidateGroupSnapshot(snapshot))
		})
	}
}
