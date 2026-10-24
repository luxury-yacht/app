package appwindow

import (
	"testing"
	"time"

	"github.com/luxury-yacht/app/internal/panelwindow"
	"github.com/stretchr/testify/require"
	"github.com/wailsapp/wails/v3/pkg/application"
)

type capturedPanelWindowEvent struct {
	target  string
	name    string
	payload any
}

// fixtureGroups remembers each fixture window's group: the index stores no
// tabs, so prepareRegistryTransferSource places them in the registry directory.
var fixtureGroups = map[*panelIndex]map[string]PanelGroupSnapshot{}

func livePanelWindowForTabTransfer(
	t *testing.T,
	panels *panelIndex,
	snapshot PanelGroupSnapshot,
) PanelWindowDescriptor {
	t.Helper()
	descriptor, err := panels.BeginOpen(snapshot)
	require.NoError(t, err)
	descriptor, err = panels.AcknowledgeOpen(descriptor.WindowName, snapshot.TransferID)
	require.NoError(t, err)
	if fixtureGroups[panels] == nil {
		fixtureGroups[panels] = make(map[string]PanelGroupSnapshot)
		t.Cleanup(func() { delete(fixtureGroups, panels) })
	}
	fixtureGroups[panels][descriptor.WindowName] = snapshot
	return descriptor
}

func directoryPanel(t *testing.T, registry *Registry, request panelwindow.TabTransferRequest) panelwindow.WorkspacePanel {
	t.Helper()
	for _, panel := range registry.workspace.Snapshot(request.ClusterID).Panels {
		if panel.Tab.PanelID == request.Tab.PanelID {
			return panel
		}
	}
	t.Fatalf("panel %q is missing from the directory", request.Tab.PanelID)
	return panelwindow.WorkspacePanel{}
}

func eventNames(events []capturedPanelWindowEvent) []string {
	names := make([]string, 0, len(events))
	for _, event := range events {
		names = append(names, event.target+":"+event.name)
	}
	return names
}

func TestNativeTabTargetCommitsOnlyWhenItAcknowledgesTheMountedTab(t *testing.T) {
	lifecycle := newLifecycle()
	ownerWindowName := lifecycle.Add()
	panels := newPanelIndex()

	sourceSnapshot := validPanelGroupSnapshot()
	sourceSnapshot.SourceWindowName = ownerWindowName
	sourceSnapshot.GroupID = "source-group"
	source := livePanelWindowForTabTransfer(t, panels, sourceSnapshot)

	targetSnapshot := validPanelGroupSnapshot()
	targetSnapshot.TransferID = "target-open"
	targetSnapshot.SourceWindowName = ownerWindowName
	targetSnapshot.GroupID = "target-group"
	targetSnapshot.Tabs[0].PanelID = "target-tab"
	targetSnapshot.Tabs[0].ObjectRef.Name = "worker"
	targetSnapshot.ActivePanelID = "target-tab"
	target := livePanelWindowForTabTransfer(t, panels, targetSnapshot)

	events := make([]capturedPanelWindowEvent, 0, 4)
	registry := &Registry{
		lifecycle:          lifecycle,
		panels:             panels,
		panelOpenTimeout:   0,
		tabTransferTimeout: 0,
		emitWindowEvent: func(target, name string, payload any) bool {
			events = append(events, capturedPanelWindowEvent{target: target, name: name, payload: payload})
			return true
		},
	}
	// The dragged tab shows a view the source has not published yet.
	moved := sourceSnapshot.Tabs[0]
	moved.ActiveView = "yaml"
	request := panelwindow.TabTransferRequest{
		TransferID:       "tab-transfer-1",
		SourceWindowName: source.WindowName,
		TargetWindowName: target.WindowName,
		ClusterID:        source.ClusterID,
		SourceGroupID:    source.GroupID,
		TargetGroupID:    target.GroupID,
		TargetIndex:      1,
		TargetKind:       panelwindow.TabTransferTargetPanelWindow,
		Tab:              moved,
	}

	prepareRegistryTransferSource(t, registry, request)
	require.NoError(t, registry.RequestPanelTabTransfer(target.WindowName, request))
	require.Equal(t, []string{source.WindowName + ":" + panelwindow.TabTransferRequestedEventName}, eventNames(events))
	require.NoError(t, registry.AcceptPanelTabTransfer(source.WindowName, request.TransferID))
	require.Contains(t, eventNames(events), target.WindowName+":"+panelwindow.TabTransferInsertRequestedEventName)
	pending := directoryPanel(t, registry, request)
	require.Equal(t, source.WindowName, pending.Location.WindowName)
	require.Equal(t, panelwindow.PanelLocation{Kind: panelwindow.PanelLocationWindow, WindowName: target.WindowName, GroupID: target.GroupID, Index: 1, Active: true}, pending.Transfer.Target)

	// The target mounts the tab and publishes; publication alone commits nothing.
	targetWithTransferredTab := targetSnapshot
	targetWithTransferredTab.Tabs = append(targetWithTransferredTab.Tabs, moved)
	targetWithTransferredTab.ActivePanelID = moved.PanelID
	require.NoError(t, registry.PublishPanelWindowGroup(target.WindowName, nativeGroup(targetWithTransferredTab)))
	require.NotContains(t, eventNames(events), source.WindowName+":"+panelwindow.TabTransferCommittedEventName)
	require.Equal(t, source.WindowName, directoryPanel(t, registry, request).Location.WindowName)

	require.Error(t, registry.AcknowledgePanelTransfer(source.WindowName, request.TransferID, true), "only the target settles its copy")
	require.NoError(t, registry.AcknowledgePanelTransfer(target.WindowName, request.TransferID, true))
	require.Contains(t, events, capturedPanelWindowEvent{
		target:  source.WindowName,
		name:    panelwindow.TabTransferCommittedEventName,
		payload: panelwindow.TabTransferCommittedEvent{Request: request},
	})
	committed := directoryPanel(t, registry, request)
	require.Equal(t, panelwindow.PanelLocation{Kind: panelwindow.PanelLocationWindow, WindowName: target.WindowName, GroupID: target.GroupID, Index: 1, Active: true}, committed.Location)
	require.Equal(t, "yaml", committed.Tab.ActiveView)
	require.Empty(t, registry.tabTransfers.pending)
}

func TestPanelTabTransferRejectsCrossClusterNativeTargets(t *testing.T) {
	lifecycle := newLifecycle()
	ownerWindowName := lifecycle.Add()
	panels := newPanelIndex()

	sourceSnapshot := validPanelGroupSnapshot()
	sourceSnapshot.SourceWindowName = ownerWindowName
	sourceSnapshot.GroupID = "source-group"
	source := livePanelWindowForTabTransfer(t, panels, sourceSnapshot)

	targetSnapshot := validPanelGroupSnapshot()
	targetSnapshot.TransferID = "target-open"
	targetSnapshot.SourceWindowName = ownerWindowName
	targetSnapshot.ClusterID = "cluster-2"
	targetSnapshot.GroupID = "target-group"
	targetSnapshot.Tabs[0].PanelID = "target-tab"
	targetSnapshot.Tabs[0].ObjectRef.ClusterID = "cluster-2"
	targetSnapshot.ActivePanelID = "target-tab"
	target := livePanelWindowForTabTransfer(t, panels, targetSnapshot)

	registry := &Registry{
		lifecycle:       lifecycle,
		panels:          panels,
		emitWindowEvent: func(string, string, any) bool { return true },
	}
	request := panelwindow.TabTransferRequest{
		TransferID:       "tab-transfer-1",
		SourceWindowName: source.WindowName,
		TargetWindowName: target.WindowName,
		ClusterID:        source.ClusterID,
		SourceGroupID:    source.GroupID,
		TargetGroupID:    target.GroupID,
		TargetKind:       panelwindow.TabTransferTargetPanelWindow,
		Tab:              sourceSnapshot.Tabs[0],
	}

	prepareRegistryTransferSource(t, registry, request)
	err := registry.RequestPanelTabTransfer(target.WindowName, request)
	require.ErrorContains(t, err, "owner and cluster")
	require.Empty(t, registry.tabTransfers.pending)
}

func TestNewPanelWindowTabTransferCommitsOnlyAfterTargetReadiness(t *testing.T) {
	wailsApp := application.New(application.Options{})
	registry := NewRegistry(wailsApp, &recordingLifecycleBackend{})
	registry.panelOpenTimeout = 0
	registry.tabTransferTimeout = 20 * time.Millisecond
	owner := registry.Create(true)
	request := panelwindow.TabTransferRequest{
		TransferID:       "tab-transfer-new-window",
		SourceWindowName: owner.Name(),
		ClusterID:        "cluster-1",
		SourceGroupID:    "right",
		TargetGroupID:    "floating-tab-transfer",
		TargetKind:       panelwindow.TabTransferTargetNewWindow,
		Tab:              validPanelGroupSnapshot().Tabs[0],
	}
	events := make([]capturedPanelWindowEvent, 0, 3)
	registry.emitWindowEvent = func(target, name string, payload any) bool {
		events = append(events, capturedPanelWindowEvent{target: target, name: name, payload: payload})
		return true
	}
	registry.showWindow = func(string) bool { return true }

	prepareRegistryTransferSource(t, registry, request)
	require.NoError(t, registry.RequestPanelTabTransfer(owner.Name(), request))
	require.NoError(t, registry.AcceptPanelTabTransfer(owner.Name(), request.TransferID))
	require.Len(t, events, 1)

	snapshot := validPanelGroupSnapshot()
	snapshot.TransferID = request.TransferID
	snapshot.SourceWindowName = request.SourceWindowName
	snapshot.ClusterID = request.ClusterID
	snapshot.GroupID = request.TargetGroupID
	snapshot.Tabs = []panelwindow.TabSnapshot{request.Tab}
	snapshot.ActivePanelID = request.Tab.PanelID
	descriptor, err := registry.BeginPanelWindowOpen(snapshot)
	require.NoError(t, err)
	require.Len(t, events, 1)
	time.Sleep(40 * time.Millisecond)
	require.Contains(t, registry.tabTransfers.pending, request.TransferID)

	_, err = registry.AcknowledgePanelWindowReady(descriptor.WindowName, request.TransferID)
	require.NoError(t, err)
	require.Equal(t, []string{
		panelwindow.TabTransferRequestedEventName,
		panelwindow.WindowOpenedEventName,
		panelwindow.TabTransferCommittedEventName,
	}, []string{events[0].name, events[1].name, events[2].name})
	require.Equal(t, owner.Name(), events[2].target)
	require.Equal(t, panelwindow.TabTransferCommittedEvent{Request: request}, events[2].payload)
	require.Empty(t, registry.tabTransfers.pending)
}

func TestPanelTabTransferReservesOneSourceTab(t *testing.T) {
	lifecycle := newLifecycle()
	ownerWindowName := lifecycle.Add()
	panels := newPanelIndex()
	sourceSnapshot := validPanelGroupSnapshot()
	sourceSnapshot.SourceWindowName = ownerWindowName
	sourceSnapshot.GroupID = "source-group"
	source := livePanelWindowForTabTransfer(t, panels, sourceSnapshot)
	targetSnapshot := validPanelGroupSnapshot()
	targetSnapshot.TransferID = "target-open"
	targetSnapshot.SourceWindowName = ownerWindowName
	targetSnapshot.GroupID = "target-group"
	targetSnapshot.Tabs[0].PanelID = "target-tab"
	targetSnapshot.Tabs[0].ObjectRef.Name = "worker"
	targetSnapshot.ActivePanelID = "target-tab"
	target := livePanelWindowForTabTransfer(t, panels, targetSnapshot)
	registry := &Registry{
		lifecycle:       lifecycle,
		panels:          panels,
		emitWindowEvent: func(string, string, any) bool { return true },
	}
	request := panelwindow.TabTransferRequest{
		TransferID:       "tab-transfer-1",
		SourceWindowName: source.WindowName,
		TargetWindowName: target.WindowName,
		ClusterID:        source.ClusterID,
		SourceGroupID:    source.GroupID,
		TargetGroupID:    target.GroupID,
		TargetKind:       panelwindow.TabTransferTargetPanelWindow,
		Tab:              sourceSnapshot.Tabs[0],
	}

	prepareRegistryTransferSource(t, registry, request)
	require.NoError(t, registry.RequestPanelTabTransfer(target.WindowName, request))
	request.TransferID = "tab-transfer-2"
	prepareRegistryTransferSource(t, registry, request)
	err := registry.RequestPanelTabTransfer(target.WindowName, request)

	require.ErrorContains(t, err, "already has a pending transfer")
	require.Len(t, registry.tabTransfers.pending, 1)
}

func TestWorkspaceTabTargetLearnsFromTheDirectoryAndSettlesTheMove(t *testing.T) {
	for _, mounted := range []bool{true, false} {
		t.Run(map[bool]string{true: "mounted", false: "rejected"}[mounted], func(t *testing.T) {
			lifecycle := newLifecycle()
			ownerWindowName := lifecycle.Add()
			panels := newPanelIndex()
			sourceSnapshot := validPanelGroupSnapshot()
			sourceSnapshot.SourceWindowName = ownerWindowName
			sourceSnapshot.GroupID = "source-group"
			source := livePanelWindowForTabTransfer(t, panels, sourceSnapshot)
			events := make([]capturedPanelWindowEvent, 0, 3)
			registry := &Registry{
				lifecycle: lifecycle,
				panels:    panels,
				emitWindowEvent: func(target, name string, payload any) bool {
					events = append(events, capturedPanelWindowEvent{target: target, name: name, payload: payload})
					return true
				},
			}
			request := panelwindow.TabTransferRequest{
				TransferID:       "tab-transfer-workspace",
				SourceWindowName: source.WindowName,
				TargetWindowName: ownerWindowName,
				ClusterID:        source.ClusterID,
				SourceGroupID:    source.GroupID,
				TargetGroupID:    "bottom",
				TargetKind:       panelwindow.TabTransferTargetWorkspace,
				Tab:              sourceSnapshot.Tabs[0],
			}

			prepareRegistryTransferSource(t, registry, request)
			require.NoError(t, registry.RequestPanelTabTransfer(ownerWindowName, request))
			require.NoError(t, registry.AcceptPanelTabTransfer(source.WindowName, request.TransferID))
			require.Contains(t, eventNames(events), ownerWindowName+":"+panelwindow.WorkspaceChangedEventName)
			require.NotContains(t, eventNames(events), ownerWindowName+":"+panelwindow.TabTransferInsertRequestedEventName)
			require.Equal(t, ownerWindowName, directoryPanel(t, registry, request).Transfer.Target.WindowName)
			require.NoError(t, registry.PublishDockedPanels(ownerWindowName, []panelwindow.WorkspaceGroup{{ClusterID: request.ClusterID, GroupID: "bottom", Tabs: []panelwindow.TabSnapshot{request.Tab}, ActivePanelID: request.Tab.PanelID}}))
			require.Equal(t, source.WindowName, directoryPanel(t, registry, request).Location.WindowName)

			events = events[:0]
			require.NoError(t, registry.AcknowledgePanelTransfer(ownerWindowName, request.TransferID, mounted))

			settled := directoryPanel(t, registry, request)
			require.Zero(t, settled.Transfer)
			require.Empty(t, registry.tabTransfers.pending)
			if mounted {
				require.Equal(t, ownerWindowName, settled.Location.WindowName)
				require.Empty(t, requireNativeGroup(t, registry, source.WindowName).Tabs, "the source no longer holds the moved tab")
				require.Contains(t, eventNames(events), source.WindowName+":"+panelwindow.TabTransferCommittedEventName)
				return
			}
			require.Equal(t, source.WindowName, settled.Location.WindowName, "a rejected move keeps the source")
			require.Equal(t, nativeGroup(sourceSnapshot), requireNativeGroup(t, registry, source.WindowName))
			require.Contains(t, eventNames(events), source.WindowName+":"+panelwindow.TabTransferFailedEventName)
			require.Contains(t, eventNames(events), ownerWindowName+":"+panelwindow.WorkspaceChangedEventName, "the target re-reads and drops its copy")
		})
	}
}

func TestFailNewPanelWindowTabTransferClosesItsOpeningTarget(t *testing.T) {
	wailsApp := application.New(application.Options{})
	registry := NewRegistry(wailsApp, &recordingLifecycleBackend{})
	registry.panelOpenTimeout = 0
	registry.tabTransferTimeout = 0
	owner := registry.Create(true)
	request := panelwindow.TabTransferRequest{
		TransferID:       "tab-transfer-failed-open",
		SourceWindowName: owner.Name(),
		ClusterID:        "cluster-1",
		SourceGroupID:    "right",
		TargetGroupID:    "floating-tab-transfer",
		TargetKind:       panelwindow.TabTransferTargetNewWindow,
		Tab:              validPanelGroupSnapshot().Tabs[0],
	}
	registry.emitWindowEvent = func(string, string, any) bool { return true }
	var closedWindowName string
	registry.closeWindow = func(windowName string) bool {
		closedWindowName = windowName
		return true
	}
	prepareRegistryTransferSource(t, registry, request)
	require.NoError(t, registry.RequestPanelTabTransfer(owner.Name(), request))
	require.NoError(t, registry.AcceptPanelTabTransfer(owner.Name(), request.TransferID))
	snapshot := validPanelGroupSnapshot()
	snapshot.TransferID = request.TransferID
	snapshot.SourceWindowName = request.SourceWindowName
	snapshot.ClusterID = request.ClusterID
	snapshot.GroupID = request.TargetGroupID
	snapshot.Tabs = []panelwindow.TabSnapshot{request.Tab}
	snapshot.ActivePanelID = request.Tab.PanelID
	descriptor, err := registry.BeginPanelWindowOpen(snapshot)
	require.NoError(t, err)

	require.NoError(t, registry.FailPanelTabTransfer(owner.Name(), request.TransferID))

	require.Equal(t, descriptor.WindowName, closedWindowName)
	require.Equal(t, PanelWindowStateMissing, registry.panels.State(descriptor.WindowName))
	require.Empty(t, registry.tabTransfers.pending)
}

func TestExpiredNewWindowTabTransferRejectsLateTargetOpen(t *testing.T) {
	wailsApp := application.New(application.Options{})
	registry := NewRegistry(wailsApp, &recordingLifecycleBackend{})
	registry.panelOpenTimeout = 0
	registry.tabTransferTimeout = 20 * time.Millisecond
	owner := registry.Create(true)
	request := panelwindow.TabTransferRequest{
		TransferID:       "tab-transfer-expired-open",
		SourceWindowName: owner.Name(),
		ClusterID:        "cluster-1",
		SourceGroupID:    "right",
		TargetGroupID:    "floating-tab-transfer",
		TargetKind:       panelwindow.TabTransferTargetNewWindow,
		Tab:              validPanelGroupSnapshot().Tabs[0],
	}
	failed := make(chan struct{}, 1)
	registry.emitWindowEvent = func(_ string, eventName string, _ any) bool {
		if eventName == panelwindow.TabTransferFailedEventName {
			select {
			case failed <- struct{}{}:
			default:
			}
		}
		return true
	}
	prepareRegistryTransferSource(t, registry, request)
	require.NoError(t, registry.RequestPanelTabTransfer(owner.Name(), request))
	require.NoError(t, registry.AcceptPanelTabTransfer(owner.Name(), request.TransferID))
	select {
	case <-failed:
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for expired panel tab transfer")
	}
	require.Empty(t, registry.tabTransfers.pending)

	snapshot := validPanelGroupSnapshot()
	snapshot.TransferID = request.TransferID
	snapshot.SourceWindowName = request.SourceWindowName
	snapshot.ClusterID = request.ClusterID
	snapshot.GroupID = request.TargetGroupID
	snapshot.Tabs = []panelwindow.TabSnapshot{request.Tab}
	snapshot.ActivePanelID = request.Tab.PanelID
	_, err := registry.BeginPanelWindowOpen(snapshot)

	require.ErrorContains(t, err, "no longer pending")
	require.Empty(t, registry.panels.Names(""))
}

func TestPanelTabTransferTimeoutFailsAllParticipantsWithoutChangingSource(t *testing.T) {
	lifecycle := newLifecycle()
	ownerWindowName := lifecycle.Add()
	panels := newPanelIndex()
	sourceSnapshot := validPanelGroupSnapshot()
	sourceSnapshot.SourceWindowName = ownerWindowName
	sourceSnapshot.GroupID = "source-group"
	source := livePanelWindowForTabTransfer(t, panels, sourceSnapshot)
	targetSnapshot := validPanelGroupSnapshot()
	targetSnapshot.TransferID = "target-open"
	targetSnapshot.SourceWindowName = ownerWindowName
	targetSnapshot.GroupID = "target-group"
	targetSnapshot.Tabs[0].PanelID = "target-tab"
	targetSnapshot.Tabs[0].ObjectRef.Name = "worker"
	targetSnapshot.ActivePanelID = "target-tab"
	target := livePanelWindowForTabTransfer(t, panels, targetSnapshot)
	failedEvents := make(chan capturedPanelWindowEvent, 3)
	registry := &Registry{
		lifecycle:          lifecycle,
		panels:             panels,
		tabTransferTimeout: 20 * time.Millisecond,
		emitWindowEvent: func(target, name string, payload any) bool {
			if name == panelwindow.TabTransferFailedEventName {
				failedEvents <- capturedPanelWindowEvent{target: target, name: name, payload: payload}
			}
			return true
		},
	}
	request := panelwindow.TabTransferRequest{
		TransferID:       "tab-transfer-timeout",
		SourceWindowName: source.WindowName,
		TargetWindowName: target.WindowName,
		ClusterID:        source.ClusterID,
		SourceGroupID:    source.GroupID,
		TargetGroupID:    target.GroupID,
		TargetKind:       panelwindow.TabTransferTargetPanelWindow,
		Tab:              sourceSnapshot.Tabs[0],
	}

	prepareRegistryTransferSource(t, registry, request)
	require.NoError(t, registry.RequestPanelTabTransfer(target.WindowName, request))
	targets := make([]string, 0, 3)
	for range 2 {
		select {
		case event := <-failedEvents:
			targets = append(targets, event.target)
			require.Equal(t, panelwindow.TabTransferFailedEvent{
				Request: request,
				Reason:  "panel tab transfer timed out",
			}, event.payload)
		case <-time.After(time.Second):
			t.Fatal("timed out waiting for panel tab transfer failure")
		}
	}
	require.ElementsMatch(t, []string{source.WindowName, target.WindowName}, targets)
	require.Equal(t, nativeGroup(sourceSnapshot), requireNativeGroup(t, registry, source.WindowName))
	require.Empty(t, registry.tabTransfers.pending)
}

func TestClosingTransferTargetPreservesSourceAndIgnoresUnrelatedWindowClosure(t *testing.T) {
	registry := NewRegistry(application.New(application.Options{}), &recordingLifecycleBackend{})
	registry.tabTransferTimeout = 0
	registry.closeWindow = func(string) bool { return true }
	var failures []capturedPanelWindowEvent
	registry.emitWindowEvent = func(target, name string, payload any) bool {
		if name == panelwindow.TabTransferFailedEventName {
			failures = append(failures, capturedPanelWindowEvent{target: target, name: name, payload: payload})
		}
		return true
	}
	open := func(name string) PanelWindowDescriptor {
		snapshot := validPanelGroupSnapshot()
		snapshot.TransferID = name + "-open"
		snapshot.GroupID = name + "-group"
		snapshot.Tabs[0].PanelID = name
		snapshot.Tabs[0].ObjectRef.Name = name
		snapshot.ActivePanelID = name
		return livePanelWindowForTabTransfer(t, registry.panels, snapshot)
	}
	source, target, unrelated := open("source"), open("target"), open("unrelated")
	request := panelwindow.TabTransferRequest{
		TransferID: "close-target", SourceWindowName: source.WindowName, TargetWindowName: target.WindowName,
		ClusterID: source.ClusterID, SourceGroupID: source.GroupID, TargetGroupID: target.GroupID,
		TargetKind: panelwindow.TabTransferTargetPanelWindow, Tab: fixtureGroups[registry.panels][source.WindowName].Tabs[0],
	}
	prepareRegistryTransferSource(t, registry, request)
	require.NoError(t, registry.RequestPanelTabTransfer(target.WindowName, request))
	require.NoError(t, registry.AcknowledgePanelWindowClose(unrelated.WindowName))
	require.Empty(t, failures)
	require.NoError(t, registry.AcceptPanelTabTransfer(source.WindowName, request.TransferID))
	require.NoError(t, registry.AcknowledgePanelWindowClose(target.WindowName))
	require.Len(t, failures, 2)
	require.ElementsMatch(t, []string{source.WindowName, target.WindowName}, []string{failures[0].target, failures[1].target})
	for _, failure := range failures {
		require.Equal(t, request, failure.payload.(panelwindow.TabTransferFailedEvent).Request)
	}
	require.Equal(t, nativeGroup(fixtureGroups[registry.panels][source.WindowName]), requireNativeGroup(t, registry, source.WindowName))
	require.Equal(t, PanelWindowStateMissing, registry.panels.State(target.WindowName))
	require.Error(t, registry.AcceptPanelTabTransfer(source.WindowName, request.TransferID))
	panels := registry.workspace.Snapshot(source.ClusterID).Panels
	require.Len(t, panels, 1)
	require.Equal(t, request.Tab, panels[0].Tab)
	require.Equal(t, source.WindowName, panels[0].Location.WindowName)
}

// requireNativeGroup reads the group the directory places in a native window.
func requireNativeGroup(t *testing.T, registry *Registry, windowName string) panelwindow.WorkspaceGroup {
	t.Helper()
	descriptor, err := registry.PanelDescriptor(windowName)
	require.NoError(t, err)
	return descriptor.Group
}

func prepareRegistryTransferSource(t *testing.T, registry *Registry, request panelwindow.TabTransferRequest) {
	t.Helper()
	if registry.workspace == nil {
		registry.workspace = panelwindow.NewWorkspaceDirectory()
	}
	if registry.backend == nil {
		registry.backend = &recordingLifecycleBackend{}
	}
	if len(registry.workspace.Snapshot(request.ClusterID).Panels) > 0 {
		return
	}
	for name, snapshot := range fixtureGroups[registry.panels] {
		seedNativeGroup(t, registry.workspace, name, snapshot)
	}
	if registry.lifecycle.Contains(request.SourceWindowName) {
		_, _, err := registry.workspace.Open(request.Tab, panelwindow.PanelLocation{Kind: panelwindow.PanelLocationDocked, WindowName: request.SourceWindowName, GroupID: request.SourceGroupID})
		require.NoError(t, err)
	}
}
