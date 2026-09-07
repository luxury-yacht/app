package appwindow

import (
	"github.com/luxury-yacht/app/internal/panelwindow"
	"github.com/stretchr/testify/require"
	"github.com/wailsapp/wails/v3/pkg/application"
	"testing"
	"time"
)

func TestClusterTabTransferWaitsForSourceAndDestinationAndRejectsStaleAcknowledgement(t *testing.T) {
	backend := &recordingLifecycleBackend{}
	registry := NewRegistry(application.New(application.Options{}), backend)
	source, target := registry.Create(true).Name(), registry.Create(false).Name()
	require.NoError(t, registry.AcknowledgePanelWorkspaceReady(target))
	var events []string
	registry.emitWindowEvent = func(name, event string, _ any) bool { events = append(events, name+":"+event); return true }
	request := panelwindow.ClusterTabTransferRequest{TransferID: "cluster-move", ClusterID: "cluster-1", SourceWindowName: source, TargetWindowName: target, TargetIndex: 0}
	require.NoError(t, registry.RequestClusterTabTransfer(target, request))
	require.Equal(t, []string{source + ":" + panelwindow.ClusterTabTransferRequestedEventName}, events)
	require.Error(t, registry.AcknowledgeClusterTabTransfer(target, request.TransferID))
	snapshot := panelwindow.ClusterViewSnapshot{SchemaVersion: 1, ViewState: "{}"}
	require.NoError(t, registry.AcceptClusterTabTransfer(source, request.TransferID, snapshot))
	require.Contains(t, events, target+":"+panelwindow.ClusterTabTransferInsertEventName)
	require.NoError(t, registry.AcknowledgeClusterTabTransfer(target, request.TransferID))
	require.Contains(t, events, source+":"+panelwindow.ClusterTabTransferCommittedEventName)
	require.Error(t, registry.AcknowledgeClusterTabTransfer(target, request.TransferID))
	require.Error(t, registry.RequestClusterTabTransfer(target, request))
}

func TestClusterTabTransferFailureDoesNotCloseExistingDestinationView(t *testing.T) {
	registry := NewRegistry(application.New(application.Options{}), &recordingLifecycleBackend{})
	source, target := registry.Create(true).Name(), registry.Create(false).Name()
	registry.emitWindowEvent = func(string, string, any) bool { return true }
	request := panelwindow.ClusterTabTransferRequest{TransferID: "cluster-fail", ClusterID: "cluster-1", SourceWindowName: source, TargetWindowName: target}
	require.NoError(t, registry.RequestClusterTabTransfer(target, request))
	require.NoError(t, registry.AcceptClusterTabTransfer(source, request.TransferID, panelwindow.ClusterViewSnapshot{SchemaVersion: 1, ViewState: "{}"}))
	require.NoError(t, registry.FailClusterTabTransfer(target, request.TransferID))
	require.True(t, registry.windowHasCluster(source, "cluster-1"))
	require.True(t, registry.windowHasCluster(target, "cluster-1"))
	require.Error(t, registry.AcknowledgeClusterTabTransfer(target, request.TransferID))
}

func TestClusterTransferTargetPublicationPreservesSourceUntilAcknowledgement(t *testing.T) {
	registry := NewRegistry(application.New(application.Options{}), &recordingLifecycleBackend{})
	source, target := registry.Create(true).Name(), registry.Create(false).Name()
	registry.emitWindowEvent = func(string, string, any) bool { return true }
	tab := validPanelGroupSnapshot().Tabs[0]
	groups := []panelwindow.WorkspaceGroup{{ClusterID: "cluster-1", GroupID: "right", Tabs: []panelwindow.TabSnapshot{tab}, ActivePanelID: tab.PanelID}}
	require.NoError(t, registry.PublishDockedPanels(source, groups))
	request := panelwindow.ClusterTabTransferRequest{TransferID: "cluster-with-panels", ClusterID: "cluster-1", SourceWindowName: source, TargetWindowName: target}
	require.NoError(t, registry.RequestClusterTabTransfer(target, request))
	require.NoError(t, registry.AcceptClusterTabTransfer(source, request.TransferID, panelwindow.ClusterViewSnapshot{SchemaVersion: 1, ViewState: "{}", Groups: groups}))
	require.NoError(t, registry.PublishDockedPanels(target, groups))
	require.Equal(t, source, registry.workspace.Snapshot("cluster-1").Panels[0].Location.WindowName)
	require.NoError(t, registry.AcknowledgeClusterTabTransfer(target, request.TransferID))
	require.Equal(t, target, registry.workspace.Snapshot("cluster-1").Panels[0].Location.WindowName)
}

func TestCancelledClusterTransferDoesNotDeliverQueuedInsert(t *testing.T) {
	registry := NewRegistry(application.New(application.Options{}), &recordingLifecycleBackend{})
	source, target := registry.Create(true).Name(), registry.Create(false).Name()
	var events []string
	registry.emitWindowEvent = func(_ string, event string, _ any) bool { events = append(events, event); return true }
	request := panelwindow.ClusterTabTransferRequest{TransferID: "cancel-before-ready", ClusterID: "cluster-1", SourceWindowName: source, TargetWindowName: target}
	require.NoError(t, registry.RequestClusterTabTransfer(target, request))
	require.NoError(t, registry.AcceptClusterTabTransfer(source, request.TransferID, panelwindow.ClusterViewSnapshot{SchemaVersion: 1, ViewState: "{}"}))
	require.NoError(t, registry.FailClusterTabTransfer(source, request.TransferID))
	require.NoError(t, registry.AcknowledgePanelWorkspaceReady(target))
	require.NotContains(t, events, panelwindow.ClusterTabTransferInsertEventName)
}

func TestClosingClusterTransferSourceCancelsPendingDestination(t *testing.T) {
	registry := NewRegistry(application.New(application.Options{}), &recordingLifecycleBackend{})
	source, target := registry.Create(true).Name(), registry.Create(false).Name()
	registry.emitWindowEvent = func(string, string, any) bool { return true }
	request := panelwindow.ClusterTabTransferRequest{TransferID: "source-closes", ClusterID: "cluster-1", SourceWindowName: source, TargetWindowName: target}
	require.NoError(t, registry.RequestClusterTabTransfer(target, request))
	require.NoError(t, registry.AcceptClusterTabTransfer(source, request.TransferID, panelwindow.ClusterViewSnapshot{SchemaVersion: 1, ViewState: "{}"}))
	registry.handleClosing(nil, source)
	require.Error(t, registry.AcknowledgeClusterTabTransfer(target, request.TransferID))
}

func TestClusterTransferReportsUnavailableDestination(t *testing.T) {
	registry := NewRegistry(application.New(application.Options{}), &recordingLifecycleBackend{})
	source, target := registry.Create(true).Name(), registry.Create(false).Name()
	require.NoError(t, registry.AcknowledgePanelWorkspaceReady(target))
	registry.emitWindowEvent = func(_ string, event string, _ any) bool {
		return event != panelwindow.ClusterTabTransferInsertEventName
	}
	request := panelwindow.ClusterTabTransferRequest{TransferID: "target-unavailable", ClusterID: "cluster-1", SourceWindowName: source, TargetWindowName: target}
	require.NoError(t, registry.RequestClusterTabTransfer(target, request))
	require.Error(t, registry.AcceptClusterTabTransfer(source, request.TransferID, panelwindow.ClusterViewSnapshot{SchemaVersion: 1, ViewState: "{}"}))
	require.Empty(t, registry.clusterTransfers)
}

func TestNewClusterTransferWindowIsSeededBeforeRendererCreation(t *testing.T) {
	backend := &recordingLifecycleBackend{windowClusters: map[string][]string{}}
	registry := NewRegistry(application.New(application.Options{}), backend)
	source := registry.Create(true).Name()
	backend.windowClusters[source] = []string{"cluster-1", "cluster-2"}
	registry.emitWindowEvent = func(string, string, any) bool { return true }
	create := registry.newWindow
	registry.newWindow = func(options application.WebviewWindowOptions) *application.WebviewWindow {
		require.Equal(t, []string{"cluster-1"}, backend.WindowClusterIDs(options.Name))
		return create(options)
	}
	request := panelwindow.ClusterTabTransferRequest{TransferID: "new-cluster-window", ClusterID: "cluster-1", SourceWindowName: source}
	require.NoError(t, registry.RequestClusterTabTransfer(source, request))
	require.NoError(t, registry.AcceptClusterTabTransfer(source, request.TransferID, panelwindow.ClusterViewSnapshot{SchemaVersion: 1, ViewState: "{}"}))
	require.NoError(t, registry.FailClusterTabTransfer(source, request.TransferID))
}

func TestCancellingNewClusterTargetAllowsSynchronousCloseHooks(t *testing.T) {
	backend := &recordingLifecycleBackend{windowClusters: map[string][]string{}}
	registry := NewRegistry(application.New(application.Options{}), backend)
	source := registry.Create(true).Name()
	backend.windowClusters[source] = []string{"cluster-1"}
	registry.emitWindowEvent = func(string, string, any) bool { return true }
	registry.closeWindow = func(name string) bool { registry.handleClosing(nil, name); return true }
	request := panelwindow.ClusterTabTransferRequest{TransferID: "new-close-hooks", ClusterID: "cluster-1", SourceWindowName: source}
	require.NoError(t, registry.RequestClusterTabTransfer(source, request))
	require.NoError(t, registry.AcceptClusterTabTransfer(source, request.TransferID, panelwindow.ClusterViewSnapshot{SchemaVersion: 1, ViewState: "{}"}))
	done := make(chan error, 1)
	go func() { done <- registry.FailClusterTabTransfer(source, request.TransferID) }()
	select {
	case err := <-done:
		require.NoError(t, err)
	case <-time.After(time.Second):
		t.Fatal("native close hook blocked on the cluster transfer lock")
	}
	require.Equal(t, []string{source}, registry.lifecycle.Names())
}
