package appwindow

import (
	"github.com/wailsapp/wails/v3/pkg/application"
	"testing"

	"github.com/luxury-yacht/app/internal/panelwindow"
	"github.com/stretchr/testify/require"
)

func TestTwoAppWindowsOpenOneSharedClusterPanel(t *testing.T) {
	lifecycle := newLifecycle()
	first := lifecycle.Add()
	second := lifecycle.Add()
	backend := &recordingLifecycleBackend{windowClusters: map[string][]string{first: {"cluster-1"}, second: {"cluster-1"}}}
	var focused string
	registry := &Registry{lifecycle: lifecycle, panels: newPanelIndex(), backend: backend,
		workspace:       panelwindow.NewWorkspaceDirectory(),
		emitWindowEvent: func(string, string, any) bool { return true },
		focusWindow:     func(name string) bool { focused = name; return true },
	}
	tab := validPanelGroupSnapshot().Tabs[0]
	opened, err := registry.OpenPanelWorkspaceObject(first, tab)
	require.NoError(t, err)
	require.True(t, opened.Render)
	openedAgain, err := registry.OpenPanelWorkspaceObject(second, tab)
	require.NoError(t, err)
	require.False(t, openedAgain.Render)
	require.Equal(t, first, focused)
	snapshot, err := registry.GetPanelWorkspace(second, "cluster-1")
	require.NoError(t, err)
	require.Len(t, snapshot.Panels, 1)
	require.Equal(t, first, snapshot.Panels[0].Location.WindowName)
	_, err = registry.GetPanelWorkspace(second, "another-cluster")
	require.Error(t, err)
}

func TestPanelSnapshotContinuesAfterOriginatingAppWindowDisappears(t *testing.T) {
	index := newPanelIndex()
	snapshot := validPanelGroupSnapshot()
	descriptor, err := index.BeginOpen(snapshot)
	require.NoError(t, err)
	_, err = index.AcknowledgeOpen(descriptor.WindowName, snapshot.TransferID)
	require.NoError(t, err)
	registry := &Registry{lifecycle: newLifecycle(), panels: index, workspace: panelwindow.NewWorkspaceDirectory(), emitWindowEvent: func(string, string, any) bool { return false }}
	snapshot.SourceWindowName = descriptor.WindowName
	snapshot.Tabs[0].ActiveView = "yaml"
	require.NoError(t, registry.UpdatePanelWindowSnapshot(descriptor.WindowName, snapshot))
	shared, err := registry.GetPanelWorkspace(descriptor.WindowName, snapshot.ClusterID)
	require.NoError(t, err)
	require.Equal(t, "yaml", shared.Panels[0].Tab.ActiveView)
	require.Equal(t, descriptor.WindowName, shared.Panels[0].Location.WindowName)
}

func TestPanelGroupIdentityBelongsToCluster(t *testing.T) {
	index := newPanelIndex()
	snapshot := validPanelGroupSnapshot()
	first, err := index.BeginOpen(snapshot)
	require.NoError(t, err)
	snapshot.SourceWindowName = "workspace-2"
	snapshot.TransferID = "another-transfer"
	_, err = index.BeginOpen(snapshot)
	require.Error(t, err, "a second app view must not create a second instance of the same cluster group")
	snapshot.ClusterID = "cluster-2"
	for i := range snapshot.Tabs {
		snapshot.Tabs[i].ObjectRef.ClusterID = snapshot.ClusterID
	}
	second, err := index.BeginOpen(snapshot)
	require.NoError(t, err)
	require.NotEqual(t, first.WindowName, second.WindowName)
}

func TestClosingLastAppViewRetainsPanelsAndLeavesPanelWindowsLive(t *testing.T) {
	lifecycle := newLifecycle()
	appName := lifecycle.Add()
	backend := &recordingLifecycleBackend{windowClusters: map[string][]string{appName: {"cluster-1"}}}
	registry := &Registry{lifecycle: lifecycle, backend: backend, panels: newPanelIndex(), workspace: panelwindow.NewWorkspaceDirectory()}
	snapshot := validPanelGroupSnapshot()
	native, err := registry.panels.BeginOpen(snapshot)
	require.NoError(t, err)
	_, err = registry.panels.AcknowledgeOpen(native.WindowName, snapshot.TransferID)
	require.NoError(t, err)
	_, _, err = registry.workspace.Open(snapshot.Tabs[0], panelwindow.PanelLocation{Kind: panelwindow.PanelLocationDocked, WindowName: appName, GroupID: "right"})
	require.NoError(t, err)
	registry.closeWindow = func(name string) bool {
		require.Equal(t, appName, name)
		registry.handleClosing(nil, name)
		return true
	}
	require.NoError(t, registry.AcknowledgeWorkspaceWindowClose(appName))
	require.Equal(t, PanelWindowStateLive, registry.panels.State(native.WindowName))
	require.Empty(t, backend.preparedWindow)
	require.Equal(t, appName, backend.savedWindow)
	require.Equal(t, appName, backend.releasedWindow)
	require.Equal(t, panelwindow.PanelLocationRetained, registry.workspace.Snapshot("cluster-1").Panels[0].Location.Kind)
}

func TestQuitPreflightsAppAndPanelRenderersBeforeClosingAny(t *testing.T) {
	lifecycle := newLifecycle()
	appName := lifecycle.Add()
	registry := &Registry{lifecycle: lifecycle, backend: &recordingLifecycleBackend{}, panels: newPanelIndex(), workspace: panelwindow.NewWorkspaceDirectory()}
	registry.markWorkspaceReady(appName)
	snapshot := validPanelGroupSnapshot()
	native, err := registry.panels.BeginOpen(snapshot)
	require.NoError(t, err)
	_, err = registry.panels.AcknowledgeOpen(native.WindowName, snapshot.TransferID)
	require.NoError(t, err)
	preflights := make(map[string]string)
	var closed []string
	registry.emitWindowEvent = func(target, name string, payload any) bool {
		if name == panelwindow.ApplicationQuitPreflightRequestedEventName {
			preflights[target] = payload.(panelwindow.ApplicationQuitPreflightRequestedEvent).TransactionID
		}
		return true
	}
	registry.closeWindow = func(name string) bool { closed = append(closed, name); return true }
	require.False(t, registry.PrepareApplicationQuit())
	require.Len(t, preflights, 2)
	require.NoError(t, registry.AcknowledgeApplicationQuitPreflight(appName, preflights[appName], true))
	require.Empty(t, closed)
	require.NoError(t, registry.AcknowledgeApplicationQuitPreflight(native.WindowName, preflights[native.WindowName], false))
	require.Empty(t, closed)
	require.Nil(t, registry.pendingQuit)
}

func TestPanelTabMovesBetweenTwoAppViewsAfterTargetPublication(t *testing.T) {
	lifecycle := newLifecycle()
	source := lifecycle.Add()
	target := lifecycle.Add()
	backend := &recordingLifecycleBackend{windowClusters: map[string][]string{source: {"cluster-1"}, target: {"cluster-1"}}}
	var events []string
	registry := &Registry{lifecycle: lifecycle, backend: backend, panels: newPanelIndex(), workspace: panelwindow.NewWorkspaceDirectory(), emitWindowEvent: func(windowName, eventName string, _ any) bool {
		events = append(events, windowName+":"+eventName)
		return true
	}}
	tab := validPanelGroupSnapshot().Tabs[0]
	require.NoError(t, registry.PublishDockedPanels(source, []panelwindow.WorkspaceGroup{{ClusterID: "cluster-1", GroupID: "right", Tabs: []panelwindow.TabSnapshot{tab}, ActivePanelID: tab.PanelID}}))
	request := panelwindow.TabTransferRequest{TransferID: "cross-app", SourceWindowName: source, TargetWindowName: target, ClusterID: "cluster-1", SourceGroupID: "right", TargetGroupID: "bottom", TargetKind: panelwindow.TabTransferTargetWorkspace, Tab: tab}
	require.NoError(t, registry.AcknowledgePanelWorkspaceReady(target))
	require.NoError(t, registry.RequestPanelTabTransfer(target, request))
	require.Contains(t, events, source+":"+panelwindow.TabTransferRequestedEventName)
	require.Error(t, registry.AcceptPanelTabTransfer(target, request.TransferID), "only the actual source may approve disposal")
	require.NoError(t, registry.AcceptPanelTabTransfer(source, request.TransferID))
	require.Contains(t, events, target+":"+panelwindow.TabTransferInsertRequestedEventName)
	require.Equal(t, source, registry.workspace.Snapshot("cluster-1").Panels[0].Location.WindowName)
	require.NoError(t, registry.PublishDockedPanels(target, []panelwindow.WorkspaceGroup{{ClusterID: "cluster-1", GroupID: "bottom", Tabs: []panelwindow.TabSnapshot{tab}, ActivePanelID: tab.PanelID}}))
	require.Equal(t, target, registry.workspace.Snapshot("cluster-1").Panels[0].Location.WindowName)
	require.Contains(t, events, source+":"+panelwindow.TabTransferCommittedEventName)
	require.NoError(t, registry.PublishDockedPanels(source, nil))
	require.Len(t, registry.workspace.Snapshot("cluster-1").Panels, 1)
}

func TestWholePanelDockKeepsSourceUntilAcknowledgementAfterTargetPublication(t *testing.T) {
	lifecycle := newLifecycle()
	target := lifecycle.Add()
	backend := &recordingLifecycleBackend{windowClusters: map[string][]string{target: {"cluster-1"}}}
	registry := &Registry{lifecycle: lifecycle, backend: backend, panels: newPanelIndex(), workspace: panelwindow.NewWorkspaceDirectory(), emitWindowEvent: func(string, string, any) bool { return true }, closeWindow: func(string) bool { return true }}
	snapshot := validPanelGroupSnapshot()
	native, err := registry.panels.BeginOpen(snapshot)
	require.NoError(t, err)
	_, err = registry.panels.AcknowledgeOpen(native.WindowName, snapshot.TransferID)
	require.NoError(t, err)
	require.NoError(t, registry.workspace.PublishWindow(native.WindowName, panelwindow.PanelLocationWindow, []panelwindow.WorkspaceGroup{{ClusterID: snapshot.ClusterID, GroupID: snapshot.GroupID, Tabs: snapshot.Tabs, ActivePanelID: snapshot.ActivePanelID}}))
	snapshot.SourceWindowName = native.WindowName
	snapshot.TransferID = "dock-after-publish"
	require.NoError(t, registry.AcknowledgePanelWorkspaceReady(target))
	require.NoError(t, registry.BeginPanelWindowDock(native.WindowName, "right", snapshot))
	require.NoError(t, registry.PublishDockedPanels(target, []panelwindow.WorkspaceGroup{{ClusterID: snapshot.ClusterID, GroupID: "right", Tabs: snapshot.Tabs, ActivePanelID: snapshot.ActivePanelID}}))
	require.Equal(t, native.WindowName, registry.workspace.Snapshot(snapshot.ClusterID).Panels[0].Location.WindowName)
	require.NoError(t, registry.AcknowledgePanelWindowDock(target, native.WindowName, snapshot.TransferID))
	require.Equal(t, target, registry.workspace.Snapshot(snapshot.ClusterID).Panels[0].Location.WindowName)
	require.Equal(t, PanelWindowStateMissing, registry.panels.State(native.WindowName))
}

func TestRejectedPanelSnapshotPreservesNativeIndexAndDirectory(t *testing.T) {
	registry := &Registry{lifecycle: newLifecycle(), panels: newPanelIndex(), workspace: panelwindow.NewWorkspaceDirectory(), emitWindowEvent: func(string, string, any) bool { return true }}
	snapshot := validPanelGroupSnapshot()
	native, err := registry.panels.BeginOpen(snapshot)
	require.NoError(t, err)
	_, err = registry.panels.AcknowledgeOpen(native.WindowName, snapshot.TransferID)
	require.NoError(t, err)
	snapshot.SourceWindowName = native.WindowName
	require.NoError(t, registry.UpdatePanelWindowSnapshot(native.WindowName, snapshot))
	foreign := snapshot.Tabs[0]
	foreign.PanelID = "foreign"
	foreign.ObjectRef.Name = "foreign"
	_, _, err = registry.workspace.Open(foreign, panelwindow.PanelLocation{Kind: panelwindow.PanelLocationDocked, WindowName: "workspace-other", GroupID: "right"})
	require.NoError(t, err)
	before, err := registry.PanelDescriptor(native.WindowName)
	require.NoError(t, err)
	beforeDirectory := registry.workspace.Snapshot(snapshot.ClusterID)
	snapshot.Tabs = append(snapshot.Tabs, foreign)
	require.Error(t, registry.UpdatePanelWindowSnapshot(native.WindowName, snapshot))
	after, err := registry.PanelDescriptor(native.WindowName)
	require.NoError(t, err)
	require.Equal(t, before, after)
	require.Equal(t, beforeDirectory, registry.workspace.Snapshot(snapshot.ClusterID))
}

func TestDockFailureNotifiesTheIndependentPanelRenderer(t *testing.T) {
	registry := NewRegistry(application.New(application.Options{}), &recordingLifecycleBackend{})
	appName := registry.Create(true).Name()
	snapshot := validPanelGroupSnapshot()
	snapshot.SourceWindowName = appName
	descriptor, err := beginTestPanelWindow(t, registry, snapshot)
	require.NoError(t, err)
	registry.showWindow = func(string) bool { return true }
	registry.emitWindowEvent = func(string, string, any) bool { return true }
	_, err = registry.AcknowledgePanelWindowReady(descriptor.WindowName, snapshot.TransferID)
	require.NoError(t, err)
	snapshot.SourceWindowName = descriptor.WindowName
	snapshot.TransferID = "dock-timeout"
	require.NoError(t, registry.BeginPanelWindowDock(descriptor.WindowName, "right", snapshot))
	var notified []string
	registry.emitWindowEvent = func(target, event string, _ any) bool {
		if event == panelwindow.WindowTransferFailedEventName {
			notified = append(notified, target)
		}
		return true
	}
	require.NoError(t, registry.FailPanelWindowTransfer(descriptor.WindowName, descriptor.WindowName, snapshot.TransferID))
	require.Contains(t, notified, descriptor.WindowName)
	require.Contains(t, notified, appName)
	require.Equal(t, PanelWindowStateLive, registry.panels.State(descriptor.WindowName))
}

func TestFailedNativePanelOpenReleasesItsClusterReference(t *testing.T) {
	for _, failure := range []string{"creation", "timeout"} {
		t.Run(failure, func(t *testing.T) {
			backend := &recordingLifecycleBackend{}
			registry := NewRegistry(application.New(application.Options{}), backend)
			source := registry.Create(true).Name()
			registry.panelOpenTimeout = 0
			registry.closeWindow = func(string) bool { return true }
			if failure == "creation" {
				registry.newWindow = func(application.WebviewWindowOptions) *application.WebviewWindow { return nil }
			}
			snapshot := validPanelGroupSnapshot()
			snapshot.SourceWindowName = source
			descriptor, err := beginTestPanelWindow(t, registry, snapshot)
			if failure == "creation" {
				require.Error(t, err)
			} else {
				require.NoError(t, err)
				registry.expirePanelOpen(descriptor.WindowName, snapshot.TransferID)
			}
			require.Contains(t, backend.releasedPanelReferences, "panel-1")
			require.Equal(t, source, registry.workspace.Snapshot(snapshot.ClusterID).Panels[0].Location.WindowName)
		})
	}
}
