package appwindow

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestValidatePanelGroupSnapshotRequiresCompleteConsistentIdentity(t *testing.T) {
	valid := validPanelGroupSnapshot()
	require.NoError(t, ValidatePanelGroupSnapshot(valid))

	for _, test := range []struct {
		name   string
		mutate func(*PanelGroupSnapshot)
	}{
		{name: "schema", mutate: func(snapshot *PanelGroupSnapshot) { snapshot.SchemaVersion = 0 }},
		{name: "transfer", mutate: func(snapshot *PanelGroupSnapshot) { snapshot.TransferID = "" }},
		{name: "owner", mutate: func(snapshot *PanelGroupSnapshot) { snapshot.OwnerWindowName = "" }},
		{name: "cluster", mutate: func(snapshot *PanelGroupSnapshot) { snapshot.ClusterID = "" }},
		{name: "group", mutate: func(snapshot *PanelGroupSnapshot) { snapshot.GroupID = "" }},
		{name: "tabs", mutate: func(snapshot *PanelGroupSnapshot) { snapshot.Tabs = nil }},
		{name: "active panel", mutate: func(snapshot *PanelGroupSnapshot) { snapshot.ActivePanelID = "missing" }},
		{name: "tab kind", mutate: func(snapshot *PanelGroupSnapshot) { snapshot.Tabs[0].Kind = "unknown" }},
		{name: "panel id", mutate: func(snapshot *PanelGroupSnapshot) { snapshot.Tabs[0].PanelID = "" }},
		{name: "active view", mutate: func(snapshot *PanelGroupSnapshot) { snapshot.Tabs[0].ActiveView = "" }},
		{name: "object cluster", mutate: func(snapshot *PanelGroupSnapshot) { snapshot.Tabs[0].ObjectRef.ClusterID = "cluster-2" }},
		{name: "object version", mutate: func(snapshot *PanelGroupSnapshot) { snapshot.Tabs[0].ObjectRef.Version = "" }},
		{name: "object kind", mutate: func(snapshot *PanelGroupSnapshot) { snapshot.Tabs[0].ObjectRef.Kind = "" }},
		{name: "object name", mutate: func(snapshot *PanelGroupSnapshot) { snapshot.Tabs[0].ObjectRef.Name = "" }},
		{
			name: "duplicate panel id",
			mutate: func(snapshot *PanelGroupSnapshot) {
				snapshot.Tabs = append(snapshot.Tabs, snapshot.Tabs[0])
			},
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			snapshot := valid
			snapshot.Tabs = append([]PanelTabSnapshot(nil), valid.Tabs...)
			test.mutate(&snapshot)

			require.Error(t, ValidatePanelGroupSnapshot(snapshot))
		})
	}
}

func validPanelGroupSnapshot() PanelGroupSnapshot {
	return PanelGroupSnapshot{
		SchemaVersion:   PanelGroupSchemaVersion,
		TransferID:      "transfer-1",
		OwnerWindowName: "workspace-1",
		ClusterID:       "cluster-1",
		GroupID:         "floating-1",
		Tabs: []PanelTabSnapshot{
			{
				Kind:       PanelTabKindObject,
				PanelID:    "panel-tab-1",
				ActiveView: "details",
				ObjectRef: PanelObjectReference{
					ClusterID: "cluster-1",
					Group:     "apps",
					Version:   "v1",
					Kind:      "Deployment",
					Namespace: "default",
					Name:      "api",
				},
			},
		},
		ActivePanelID: "panel-tab-1",
	}
}

func TestPanelTransferStateAllowsAcknowledgedOpenAndDock(t *testing.T) {
	panels := newPanelIndex()
	snapshot := validPanelGroupSnapshot()

	descriptor, err := panels.BeginOpen(snapshot)
	require.NoError(t, err)
	require.Equal(t, "panel-1", descriptor.WindowName)
	require.Equal(t, PanelWindowStateOpening, descriptor.State)

	descriptor, err = panels.AcknowledgeOpen(descriptor.WindowName, snapshot.TransferID)
	require.NoError(t, err)
	require.Equal(t, PanelWindowStateLive, descriptor.State)

	dockSnapshot := snapshot
	dockSnapshot.TransferID = "transfer-2"
	require.NoError(t, panels.BeginDock(descriptor.WindowName, dockSnapshot))
	require.Equal(t, PanelWindowStateDocking, panels.State(descriptor.WindowName))

	require.NoError(t, panels.AcknowledgeDock(descriptor.WindowName, dockSnapshot.TransferID))
	require.Equal(t, PanelWindowStateMissing, panels.State(descriptor.WindowName))
}

func TestPanelTransferStateRejectsStaleAcknowledgementsAndRollsBack(t *testing.T) {
	panels := newPanelIndex()
	openSnapshot := validPanelGroupSnapshot()
	descriptor, err := panels.BeginOpen(openSnapshot)
	require.NoError(t, err)

	_, err = panels.AcknowledgeOpen(descriptor.WindowName, "stale-open")
	require.ErrorContains(t, err, "stale panel transfer")
	require.Equal(t, PanelWindowStateOpening, panels.State(descriptor.WindowName))
	require.NoError(t, panels.FailTransfer(descriptor.WindowName, openSnapshot.TransferID))
	require.Equal(t, PanelWindowStateMissing, panels.State(descriptor.WindowName))

	retrySnapshot := openSnapshot
	retrySnapshot.TransferID = "transfer-2"
	descriptor, err = panels.BeginOpen(retrySnapshot)
	require.NoError(t, err)
	_, err = panels.AcknowledgeOpen(descriptor.WindowName, retrySnapshot.TransferID)
	require.NoError(t, err)

	dockSnapshot := retrySnapshot
	dockSnapshot.TransferID = "transfer-3"
	require.NoError(t, panels.BeginDock(descriptor.WindowName, dockSnapshot))
	require.ErrorContains(
		t,
		panels.AcknowledgeDock(descriptor.WindowName, "stale-dock"),
		"stale panel transfer",
	)
	require.Equal(t, PanelWindowStateDocking, panels.State(descriptor.WindowName))
	require.NoError(t, panels.FailTransfer(descriptor.WindowName, dockSnapshot.TransferID))
	require.Equal(t, PanelWindowStateLive, panels.State(descriptor.WindowName))
}

func TestPanelTransferDescriptorOwnsAnImmutableSnapshot(t *testing.T) {
	panels := newPanelIndex()
	snapshot := validPanelGroupSnapshot()
	descriptor, err := panels.BeginOpen(snapshot)
	require.NoError(t, err)

	snapshot.Tabs[0].ObjectRef.Name = "changed-by-source"
	stored, err := panels.Descriptor(descriptor.WindowName)
	require.NoError(t, err)
	require.Equal(t, "api", stored.Snapshot.Tabs[0].ObjectRef.Name)

	stored.Snapshot.Tabs[0].ObjectRef.Name = "changed-by-reader"
	storedAgain, err := panels.Descriptor(descriptor.WindowName)
	require.NoError(t, err)
	require.Equal(t, "api", storedAgain.Snapshot.Tabs[0].ObjectRef.Name)
}

func TestPanelTransferUpdatesOnlyLiveSnapshotState(t *testing.T) {
	panels := newPanelIndex()
	snapshot := validPanelGroupSnapshot()
	descriptor, err := panels.BeginOpen(snapshot)
	require.NoError(t, err)
	require.ErrorContains(t, panels.UpdateSnapshot(descriptor.WindowName, snapshot), "state")
	_, err = panels.AcknowledgeOpen(descriptor.WindowName, snapshot.TransferID)
	require.NoError(t, err)

	updated := snapshot
	updated.Tabs = append([]PanelTabSnapshot(nil), snapshot.Tabs...)
	updated.Tabs[0].ActiveView = "yaml"
	require.NoError(t, panels.UpdateSnapshot(descriptor.WindowName, updated))
	stored, err := panels.Descriptor(descriptor.WindowName)
	require.NoError(t, err)
	require.Equal(t, "yaml", stored.Snapshot.Tabs[0].ActiveView)

	updated.ClusterID = "cluster-2"
	updated.Tabs[0].ObjectRef.ClusterID = "cluster-2"
	require.ErrorContains(t, panels.UpdateSnapshot(descriptor.WindowName, updated), "cannot change")
}

func TestPanelTransferStateRejectsIdentityChangesAndInvalidTransitions(t *testing.T) {
	panels := newPanelIndex()
	snapshot := validPanelGroupSnapshot()
	descriptor, err := panels.BeginOpen(snapshot)
	require.NoError(t, err)

	dockSnapshot := snapshot
	dockSnapshot.TransferID = "transfer-2"
	require.ErrorContains(
		t,
		panels.BeginDock(descriptor.WindowName, dockSnapshot),
		"cannot dock from state",
	)
	_, err = panels.AcknowledgeOpen(descriptor.WindowName, snapshot.TransferID)
	require.NoError(t, err)
	_, err = panels.AcknowledgeOpen(descriptor.WindowName, snapshot.TransferID)
	require.ErrorContains(t, err, "not \"opening\"")

	for _, test := range []struct {
		name   string
		mutate func(*PanelGroupSnapshot)
	}{
		{name: "owner", mutate: func(next *PanelGroupSnapshot) { next.OwnerWindowName = "workspace-2" }},
		{
			name: "cluster",
			mutate: func(next *PanelGroupSnapshot) {
				next.ClusterID = "cluster-2"
				next.Tabs[0].ObjectRef.ClusterID = "cluster-2"
			},
		},
		{name: "group", mutate: func(next *PanelGroupSnapshot) { next.GroupID = "floating-2" }},
	} {
		t.Run(test.name, func(t *testing.T) {
			next := dockSnapshot
			next.Tabs = append([]PanelTabSnapshot(nil), dockSnapshot.Tabs...)
			test.mutate(&next)

			require.ErrorContains(
				t,
				panels.BeginDock(descriptor.WindowName, next),
				"cannot change owner, cluster, or group",
			)
		})
	}

	reused := dockSnapshot
	reused.TransferID = snapshot.TransferID
	require.ErrorContains(
		t,
		panels.BeginDock(descriptor.WindowName, reused),
		"already exists",
	)
}
