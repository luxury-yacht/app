package appwindow

import (
	"encoding/json"
	"errors"
	"github.com/luxury-yacht/app/internal/panelwindow"
	"github.com/stretchr/testify/require"
	"github.com/wailsapp/wails/v3/pkg/application"
	"slices"
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
	backend.windowClusters[source] = []string{"cluster-1", "cluster-2"}
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

func TestClusterTabTransferClosesOnlyEmptySourceAfterAcknowledgement(t *testing.T) {
	for _, test := range []struct {
		name                                                                   string
		existingTarget, duplicateTarget, sourceHasOther, removeOther, addOther bool
	}{
		{name: "last tab into new window"},
		{name: "last tab into existing window", existingTarget: true},
		{name: "last tab into duplicate cluster view", existingTarget: true, duplicateTarget: true},
		{name: "another source tab remains", sourceHasOther: true},
		{name: "other tab closes during capture", sourceHasOther: true, removeOther: true},
		{name: "another tab opens before acknowledgement", addOther: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			backend := &recordingLifecycleBackend{windowClusters: map[string][]string{}}
			registry := NewRegistry(application.New(application.Options{}), backend)
			source := registry.Create(true).Name()
			backend.windowClusters[source] = []string{"cluster-1"}
			if test.sourceHasOther {
				backend.windowClusters[source] = append(backend.windowClusters[source], "cluster-2")
			}
			target := ""
			if test.existingTarget {
				target = registry.Create(false).Name()
				backend.windowClusters[target] = []string{"cluster-2"}
				if test.duplicateTarget {
					backend.windowClusters[target] = append(backend.windowClusters[target], "cluster-1")
				}
			}
			require.NoError(t, registry.AcknowledgePanelWorkspaceReady(source))
			var events, closed []string
			registry.emitWindowEvent = func(name, event string, _ any) bool { events = append(events, name+":"+event); return true }
			registry.closeWindow = func(name string) bool {
				closed = append(closed, name)
				events = append(events, name+":close")
				// Wails can synchronously run the close hook; this must not deadlock.
				registry.handleClosing(nil, name)
				return true
			}
			tab := validPanelGroupSnapshot().Tabs[0]
			groups := []panelwindow.WorkspaceGroup{{ClusterID: "cluster-1", GroupID: "right", Tabs: []panelwindow.TabSnapshot{tab}, ActivePanelID: tab.PanelID}}
			require.NoError(t, registry.PublishDockedPanels(source, groups))
			request := panelwindow.ClusterTabTransferRequest{TransferID: "last-tab", ClusterID: "cluster-1", SourceWindowName: source, TargetWindowName: target}
			require.NoError(t, registry.RequestClusterTabTransfer(source, request))
			t.Cleanup(func() { _ = registry.FailClusterTabTransfer(source, request.TransferID) })
			if test.removeOther {
				backend.windowClusters[source] = []string{"cluster-1"}
			}
			require.NoError(t, registry.AcceptClusterTabTransfer(source, request.TransferID, panelwindow.ClusterViewSnapshot{SchemaVersion: 1, ViewState: "{}", Groups: groups}))
			target = registry.clusterTransfers[request.TransferID].event.Request.TargetWindowName
			require.NoError(t, registry.AcknowledgePanelWorkspaceReady(target))
			require.NoError(t, registry.PublishDockedPanels(target, groups))
			require.Empty(t, closed, "source must survive destination reconstruction")
			require.True(t, registry.lifecycle.Contains(source))
			require.Contains(t, backend.WindowClusterIDs(source), "cluster-1")
			require.Equal(t, source, registry.workspace.Snapshot("cluster-1").Panels[0].Location.WindowName)
			if test.addOther {
				backend.windowClusters[source] = append(backend.windowClusters[source], "cluster-2")
			}
			done := make(chan error, 1)
			go func() { done <- registry.AcknowledgeClusterTabTransfer(target, request.TransferID) }()
			select {
			case err := <-done:
				require.NoError(t, err)
			case <-time.After(time.Second):
				t.Fatal("source close hook blocked on the cluster transfer lock")
			}
			if (test.sourceHasOther && !test.removeOther) || test.addOther {
				require.Empty(t, closed)
				require.True(t, registry.lifecycle.Contains(source))
				require.Equal(t, []string{"cluster-2"}, backend.WindowClusterIDs(source))
			} else {
				require.Equal(t, []string{source}, closed)
				require.False(t, registry.lifecycle.Contains(source))
				require.Equal(t, source, backend.releasedWindow)
				require.Less(t, slices.Index(events, target+":"+panelwindow.ClusterTabTransferCommittedEventName), slices.Index(events, source+":close"))
			}
			require.Empty(t, backend.preparedWindow, "moving the last tab must not quit the application")
			require.True(t, registry.lifecycle.Contains(target))
			require.Contains(t, backend.WindowClusterIDs(target), "cluster-1")
			require.Equal(t, target, registry.workspace.Snapshot("cluster-1").Panels[0].Location.WindowName)
		})
	}
}

func TestFailedLastClusterTabTransferKeepsSourceWindow(t *testing.T) {
	for _, test := range []struct {
		name                         string
		existingTarget, rejectCommit bool
	}{
		{name: "new target cancelled"},
		{name: "existing target cancelled", existingTarget: true},
		{name: "new target commit rejected", rejectCommit: true},
		{name: "existing target commit rejected", existingTarget: true, rejectCommit: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			backend := &recordingLifecycleBackend{windowClusters: map[string][]string{}}
			registry := NewRegistry(application.New(application.Options{}), backend)
			source, target := registry.Create(true).Name(), ""
			backend.windowClusters[source] = []string{"cluster-1"}
			if test.existingTarget {
				target = registry.Create(false).Name()
				backend.windowClusters[target] = []string{"cluster-2"}
			}
			registry.emitWindowEvent = func(string, string, any) bool { return true }
			var closed []string
			registry.closeWindow = func(name string) bool { closed = append(closed, name); registry.handleClosing(nil, name); return true }
			request := panelwindow.ClusterTabTransferRequest{TransferID: "last-tab-fails", ClusterID: "cluster-1", SourceWindowName: source, TargetWindowName: target}
			require.NoError(t, registry.RequestClusterTabTransfer(source, request))
			t.Cleanup(func() { _ = registry.FailClusterTabTransfer(source, request.TransferID) })
			require.NoError(t, registry.AcceptClusterTabTransfer(source, request.TransferID, panelwindow.ClusterViewSnapshot{SchemaVersion: 1, ViewState: "{}"}))
			target = registry.clusterTransfers[request.TransferID].event.Request.TargetWindowName
			if test.rejectCommit {
				backend.commitClusterTransferError = errors.New("destination placement rejected")
				require.ErrorIs(t, registry.AcknowledgeClusterTabTransfer(target, request.TransferID), backend.commitClusterTransferError)
				require.Empty(t, closed)
			}
			require.NoError(t, registry.FailClusterTabTransfer(target, request.TransferID))
			require.NotContains(t, closed, source)
			require.True(t, registry.lifecycle.Contains(source))
			require.Equal(t, []string{"cluster-1"}, backend.WindowClusterIDs(source))
			require.Equal(t, test.existingTarget, registry.lifecycle.Contains(target))
		})
	}
}

func TestClusterTabTearOffUsesDropPositionForNativeWindowCreation(t *testing.T) {
	for _, test := range []struct {
		name         string
		drop         *panelwindow.WindowPoint
		x, y, height int
	}{
		{name: "left monitor", drop: &panelwindow.WindowPoint{X: -1100, Y: 200}, x: -1220, y: 176, height: 800},
		{name: "monitor boundary", drop: &panelwindow.WindowPoint{X: 1925, Y: 100}, x: 1920, y: 0, height: 760},
		{name: "screen origin", drop: &panelwindow.WindowPoint{}, x: 0, y: 0, height: 800},
		{name: "menu without drop", x: 124, y: 124, height: 800},
	} {
		t.Run(test.name, func(t *testing.T) {
			backend := &recordingLifecycleBackend{windowClusters: map[string][]string{}}
			registry := NewRegistry(application.New(application.Options{}), backend)
			source := registry.Create(true).Name()
			backend.windowClusters[source] = []string{"cluster-1", "cluster-2"}
			registry.emitWindowEvent = func(string, string, any) bool { return true }
			sourceScreen := &application.Screen{WorkArea: application.Rect{X: 0, Y: 0, Width: 1920, Height: 1040}}
			registry.windowGeometry = func(name string) (geometry, bool) {
				require.Equal(t, source, name)
				return geometry{X: 100, Y: 100, AbsoluteX: 100, AbsoluteY: 100, Width: 1200, Height: 800, Maximised: true, Screen: sourceScreen}, true
			}
			registry.screenWorkAreas = func() []application.Rect {
				return []application.Rect{
					{X: -1600, Y: 0, Width: 1600, Height: 1000},
					{X: 0, Y: 0, Width: 1920, Height: 1040},
					{X: 1920, Y: 0, Width: 1200, Height: 760},
				}
			}
			var created application.WebviewWindowOptions
			registry.newWindow = func(options application.WebviewWindowOptions) *application.WebviewWindow {
				created = options
				return application.NewWindow(options)
			}
			// Exercise the request wire format, including an explicit (0, 0).
			wire, err := json.Marshal(map[string]any{
				"transferId": "positioned-cluster", "clusterId": "cluster-1",
				"sourceWindowName": source, "targetWindowName": "", "targetIndex": 0,
				"dropPosition": test.drop,
			})
			require.NoError(t, err)
			var request panelwindow.ClusterTabTransferRequest
			require.NoError(t, json.Unmarshal(wire, &request))
			require.NoError(t, registry.RequestClusterTabTransfer(source, request))
			t.Cleanup(func() { _ = registry.FailClusterTabTransfer(source, request.TransferID) })
			require.NoError(t, registry.AcceptClusterTabTransfer(source, request.TransferID, panelwindow.ClusterViewSnapshot{SchemaVersion: 1, ViewState: "{}"}))
			require.Equal(t, application.WindowXY, created.InitialPosition)
			require.Equal(t, test.x, created.X)
			require.Equal(t, test.y, created.Y)
			require.Equal(t, 1200, created.Width)
			require.Equal(t, test.height, created.Height)
			if test.drop != nil {
				require.Nil(t, created.Screen, "drop positions use absolute screen coordinates")
				require.NotEqual(t, application.WindowStateMaximised, created.StartState)
			} else {
				require.Same(t, sourceScreen, created.Screen)
				require.Equal(t, application.WindowStateMaximised, created.StartState)
			}
		})
	}
}

func TestPanelOnlyClusterCanCreateAppWindowForDocking(t *testing.T) {
	backend := &recordingLifecycleBackend{windowClusters: map[string][]string{}}
	registry := NewRegistry(application.New(application.Options{}), backend)
	snapshot := validPanelGroupSnapshot()
	native, err := registry.panels.BeginOpen(snapshot)
	require.NoError(t, err)
	_, err = registry.panels.AcknowledgeOpen(native.WindowName, snapshot.TransferID)
	require.NoError(t, err)
	require.Empty(t, registry.lifecycle.Names())
	require.Empty(t, backend.WindowClusterIDs(native.WindowName))

	target, err := registry.appWindowForCluster(snapshot.ClusterID, native.WindowName)

	require.NoError(t, err)
	require.Equal(t, []string{target}, registry.lifecycle.Names())
	require.Equal(t, []string{snapshot.ClusterID}, backend.WindowClusterIDs(target))
	require.Equal(t, PanelWindowStateLive, registry.panels.State(native.WindowName))
}
