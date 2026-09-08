package appwindow

import (
	"testing"

	"github.com/luxury-yacht/app/internal/panelwindow"
	"github.com/stretchr/testify/require"
	"github.com/wailsapp/wails/v3/pkg/application"
)

func TestPanelTabMenuDockResolvesClusterTargetAndWaitsForRenderer(t *testing.T) {
	lifecycle := newLifecycle()
	target := lifecycle.Add()
	registry := &Registry{lifecycle: lifecycle, panels: newPanelIndex(), workspace: panelwindow.NewWorkspaceDirectory(), backend: &recordingLifecycleBackend{windowClusters: map[string][]string{target: {"cluster-1"}}}}
	snapshot := validPanelGroupSnapshot()
	sibling := snapshot.Tabs[0]
	sibling.PanelID = "sibling"
	sibling.ObjectRef.Name = "sibling"
	snapshot.Tabs = append(snapshot.Tabs, sibling)
	source := livePanelWindowForTabTransfer(t, registry.panels, snapshot)
	snapshot.SourceWindowName = source.WindowName
	registry.emitWindowEvent = func(string, string, any) bool { return true }
	require.NoError(t, registry.UpdatePanelWindowSnapshot(source.WindowName, snapshot))
	var events []capturedPanelWindowEvent
	registry.emitWindowEvent = func(target, name string, payload any) bool {
		events = append(events, capturedPanelWindowEvent{target: target, name: name, payload: payload})
		return true
	}
	request := panelwindow.TabTransferRequest{TransferID: "menu-dock", SourceWindowName: source.WindowName, ClusterID: source.ClusterID, SourceGroupID: source.GroupID, TargetGroupID: "bottom", TargetKind: panelwindow.TabTransferTargetWorkspace, Tab: snapshot.Tabs[0]}
	require.Error(t, registry.RequestPanelTabTransfer("unrelated-window", request))
	require.Empty(t, events)
	require.NoError(t, registry.RequestPanelTabTransfer(source.WindowName, request))
	require.Len(t, events, 1)
	resolved := events[0].payload.(panelwindow.TabTransferRequestedEvent).Request
	require.Equal(t, target, resolved.TargetWindowName)
	require.NoError(t, registry.AcceptPanelTabTransfer(source.WindowName, request.TransferID))
	require.Len(t, events, 1, "the destination must subscribe before insertion is delivered")
	require.Equal(t, snapshot, requirePanelDescriptor(t, registry.panels, source.WindowName).Snapshot)
	require.NoError(t, registry.AcknowledgePanelWorkspaceReady(target))
	require.Len(t, events, 2)
	require.Equal(t, panelwindow.TabTransferInsertRequestedEventName, events[1].name)
	require.NoError(t, registry.PublishDockedPanels(target, []panelwindow.WorkspaceGroup{{ClusterID: source.ClusterID, GroupID: "bottom", Tabs: []panelwindow.TabSnapshot{request.Tab}, ActivePanelID: request.Tab.PanelID}}))
	require.Contains(t, events, capturedPanelWindowEvent{target: source.WindowName, name: panelwindow.TabTransferCommittedEventName, payload: panelwindow.TabTransferCommittedEvent{Request: resolved}})
	snapshot.Tabs = []panelwindow.TabSnapshot{sibling}
	snapshot.ActivePanelID = sibling.PanelID
	require.NoError(t, registry.UpdatePanelWindowSnapshot(source.WindowName, snapshot))
	require.Equal(t, snapshot.Tabs, requirePanelDescriptor(t, registry.panels, source.WindowName).Snapshot.Tabs)
}

func TestPanelTabMenuDockCreatesAnAppViewWithoutAnExistingAppWindow(t *testing.T) {
	backend := &recordingLifecycleBackend{windowClusters: map[string][]string{}}
	registry := NewRegistry(application.New(application.Options{}), backend)
	registry.panelOpenTimeout = 0
	registry.tabTransferTimeout = 0
	snapshot := validPanelGroupSnapshot()
	source := livePanelWindowForTabTransfer(t, registry.panels, snapshot)
	snapshot.SourceWindowName = source.WindowName
	registry.emitWindowEvent = func(string, string, any) bool { return true }
	require.NoError(t, registry.UpdatePanelWindowSnapshot(source.WindowName, snapshot))
	request := panelwindow.TabTransferRequest{TransferID: "dock-with-no-app", SourceWindowName: source.WindowName, ClusterID: source.ClusterID, SourceGroupID: source.GroupID, TargetGroupID: "right", TargetKind: panelwindow.TabTransferTargetWorkspace, Tab: snapshot.Tabs[0]}
	stale := request
	stale.Tab.ObjectRef.Name = "stale"
	require.Error(t, registry.RequestPanelTabTransfer(source.WindowName, stale))
	require.Empty(t, registry.lifecycle.Names(), "invalid source identity must not create an app window")
	create := registry.newWindow
	registry.newWindow = func(options application.WebviewWindowOptions) *application.WebviewWindow {
		require.Equal(t, []string{source.ClusterID}, backend.WindowClusterIDs(options.Name))
		return create(options)
	}
	require.NoError(t, registry.RequestPanelTabTransfer(source.WindowName, request))
	target := registry.pendingTabTransfers[request.TransferID].request.TargetWindowName
	require.Equal(t, []string{target}, registry.lifecycle.Names())
	require.Equal(t, PanelWindowStateLive, registry.panels.State(source.WindowName))
	require.NoError(t, registry.AcceptPanelTabTransfer(source.WindowName, request.TransferID))
	require.NoError(t, registry.FailPanelTabTransfer(source.WindowName, request.TransferID))
	require.Equal(t, snapshot, requirePanelDescriptor(t, registry.panels, source.WindowName).Snapshot)
}

func TestPanelTabMenuDockCancellationDiscardsQueuedInsertion(t *testing.T) {
	lifecycle := newLifecycle()
	target := lifecycle.Add()
	registry := &Registry{lifecycle: lifecycle, panels: newPanelIndex(), workspace: panelwindow.NewWorkspaceDirectory(), backend: &recordingLifecycleBackend{windowClusters: map[string][]string{target: {"cluster-1"}}}, emitWindowEvent: func(string, string, any) bool { return true }}
	snapshot := validPanelGroupSnapshot()
	source := livePanelWindowForTabTransfer(t, registry.panels, snapshot)
	snapshot.SourceWindowName = source.WindowName
	require.NoError(t, registry.UpdatePanelWindowSnapshot(source.WindowName, snapshot))
	request := panelwindow.TabTransferRequest{TransferID: "cancel-menu-dock", SourceWindowName: source.WindowName, ClusterID: source.ClusterID, SourceGroupID: source.GroupID, TargetGroupID: "right", TargetKind: panelwindow.TabTransferTargetWorkspace, Tab: snapshot.Tabs[0]}
	require.NoError(t, registry.RequestPanelTabTransfer(source.WindowName, request))
	require.NoError(t, registry.AcceptPanelTabTransfer(source.WindowName, request.TransferID))
	require.NoError(t, registry.FailPanelTabTransfer(source.WindowName, request.TransferID))
	var insertions int
	registry.emitWindowEvent = func(_ string, name string, _ any) bool {
		if name == panelwindow.TabTransferInsertRequestedEventName {
			insertions++
		}
		return true
	}
	require.NoError(t, registry.AcknowledgePanelWorkspaceReady(target))
	require.Zero(t, insertions)
	require.Equal(t, snapshot, requirePanelDescriptor(t, registry.panels, source.WindowName).Snapshot)
}
