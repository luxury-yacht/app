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
	return descriptor
}

func TestPanelTabTransferPopulatesNativeTargetBeforeCommittingSourceRemoval(t *testing.T) {
	lifecycle := newLifecycle()
	ownerWindowName := lifecycle.Add()
	panels := newPanelIndex()

	sourceSnapshot := validPanelGroupSnapshot()
	sourceSnapshot.OwnerWindowName = ownerWindowName
	sourceSnapshot.GroupID = "source-group"
	source := livePanelWindowForTabTransfer(t, panels, sourceSnapshot)

	targetSnapshot := validPanelGroupSnapshot()
	targetSnapshot.TransferID = "target-open"
	targetSnapshot.OwnerWindowName = ownerWindowName
	targetSnapshot.GroupID = "target-group"
	targetSnapshot.Tabs[0].PanelID = "target-tab"
	targetSnapshot.Tabs[0].ObjectRef.Name = "worker"
	targetSnapshot.ActivePanelID = "target-tab"
	target := livePanelWindowForTabTransfer(t, panels, targetSnapshot)

	events := make([]capturedPanelWindowEvent, 0, 4)
	registry := &Registry{
		lifecycle:           lifecycle,
		panels:              panels,
		panelOpenTimeout:    0,
		tabTransferTimeout:  0,
		pendingTabTransfers: make(map[string]*panelTabTransfer),
		emitWindowEvent: func(target, name string, payload any) bool {
			events = append(events, capturedPanelWindowEvent{target: target, name: name, payload: payload})
			return true
		},
	}
	request := panelwindow.TabTransferRequest{
		TransferID:       "tab-transfer-1",
		SourceWindowName: source.WindowName,
		TargetWindowName: target.WindowName,
		OwnerWindowName:  ownerWindowName,
		ClusterID:        source.ClusterID,
		SourceGroupID:    source.GroupID,
		TargetGroupID:    target.GroupID,
		TargetIndex:      1,
		TargetKind:       panelwindow.TabTransferTargetPanelWindow,
		Tab:              sourceSnapshot.Tabs[0],
	}

	require.NoError(t, registry.RequestPanelTabTransfer(target.WindowName, request))
	require.Len(t, events, 1)
	require.Equal(t, ownerWindowName, events[0].target)
	require.Equal(t, panelwindow.TabTransferRequestedEventName, events[0].name)
	require.Equal(t, sourceSnapshot, requirePanelDescriptor(t, panels, source.WindowName).Snapshot)

	require.NoError(t, registry.AcceptPanelTabTransfer(ownerWindowName, request.TransferID))
	require.Len(t, events, 2)
	require.Equal(t, target.WindowName, events[1].target)
	require.Equal(t, panelwindow.TabTransferInsertRequestedEventName, events[1].name)
	require.Equal(t, sourceSnapshot, requirePanelDescriptor(t, panels, source.WindowName).Snapshot)

	targetWithTransferredTab := targetSnapshot
	targetWithTransferredTab.Tabs = append(targetWithTransferredTab.Tabs, sourceSnapshot.Tabs[0])
	targetWithTransferredTab.ActivePanelID = sourceSnapshot.Tabs[0].PanelID
	require.NoError(t, registry.UpdatePanelWindowSnapshot(target.WindowName, targetWithTransferredTab))

	require.Equal(t, sourceSnapshot, requirePanelDescriptor(t, panels, source.WindowName).Snapshot)
	require.Contains(t, events, capturedPanelWindowEvent{
		target: source.WindowName,
		name:   panelwindow.TabTransferCommittedEventName,
		payload: panelwindow.TabTransferCommittedEvent{
			Request: request,
		},
	})
	_, pending := registry.pendingTabTransfers[request.TransferID]
	require.False(t, pending)
}

func TestPanelTabTransferRejectsCrossClusterNativeTargets(t *testing.T) {
	lifecycle := newLifecycle()
	ownerWindowName := lifecycle.Add()
	panels := newPanelIndex()

	sourceSnapshot := validPanelGroupSnapshot()
	sourceSnapshot.OwnerWindowName = ownerWindowName
	sourceSnapshot.GroupID = "source-group"
	source := livePanelWindowForTabTransfer(t, panels, sourceSnapshot)

	targetSnapshot := validPanelGroupSnapshot()
	targetSnapshot.TransferID = "target-open"
	targetSnapshot.OwnerWindowName = ownerWindowName
	targetSnapshot.ClusterID = "cluster-2"
	targetSnapshot.GroupID = "target-group"
	targetSnapshot.Tabs[0].PanelID = "target-tab"
	targetSnapshot.Tabs[0].ObjectRef.ClusterID = "cluster-2"
	targetSnapshot.ActivePanelID = "target-tab"
	target := livePanelWindowForTabTransfer(t, panels, targetSnapshot)

	registry := &Registry{
		lifecycle:           lifecycle,
		panels:              panels,
		pendingTabTransfers: make(map[string]*panelTabTransfer),
		emitWindowEvent:     func(string, string, any) bool { return true },
	}
	request := panelwindow.TabTransferRequest{
		TransferID:       "tab-transfer-1",
		SourceWindowName: source.WindowName,
		TargetWindowName: target.WindowName,
		OwnerWindowName:  ownerWindowName,
		ClusterID:        source.ClusterID,
		SourceGroupID:    source.GroupID,
		TargetGroupID:    target.GroupID,
		TargetKind:       panelwindow.TabTransferTargetPanelWindow,
		Tab:              sourceSnapshot.Tabs[0],
	}

	err := registry.RequestPanelTabTransfer(target.WindowName, request)
	require.ErrorContains(t, err, "owner and cluster")
	require.Empty(t, registry.pendingTabTransfers)
}

func TestNewPanelWindowTabTransferCommitsOnlyAfterTargetReadiness(t *testing.T) {
	wailsApp := application.New(application.Options{})
	registry := NewRegistry(wailsApp, nil)
	registry.panelOpenTimeout = 0
	registry.tabTransferTimeout = 20 * time.Millisecond
	owner := registry.Create(true)
	request := panelwindow.TabTransferRequest{
		TransferID:       "tab-transfer-new-window",
		SourceWindowName: owner.Name(),
		OwnerWindowName:  owner.Name(),
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

	require.NoError(t, registry.RequestPanelTabTransfer(owner.Name(), request))
	require.NoError(t, registry.AcceptPanelTabTransfer(owner.Name(), request.TransferID))
	require.Len(t, events, 1)

	snapshot := validPanelGroupSnapshot()
	snapshot.TransferID = request.TransferID
	snapshot.OwnerWindowName = request.OwnerWindowName
	snapshot.ClusterID = request.ClusterID
	snapshot.GroupID = request.TargetGroupID
	snapshot.Tabs = []panelwindow.TabSnapshot{request.Tab}
	snapshot.ActivePanelID = request.Tab.PanelID
	descriptor, err := registry.BeginPanelWindowOpen(snapshot)
	require.NoError(t, err)
	require.Len(t, events, 1)
	time.Sleep(40 * time.Millisecond)
	require.Contains(t, registry.pendingTabTransfers, request.TransferID)

	_, err = registry.AcknowledgePanelWindowReady(descriptor.WindowName, request.TransferID)
	require.NoError(t, err)
	require.Equal(t, []string{
		panelwindow.TabTransferRequestedEventName,
		panelwindow.WindowOpenedEventName,
		panelwindow.TabTransferCommittedEventName,
	}, []string{events[0].name, events[1].name, events[2].name})
	require.Equal(t, owner.Name(), events[2].target)
	require.Equal(t, panelwindow.TabTransferCommittedEvent{Request: request}, events[2].payload)
	require.Empty(t, registry.pendingTabTransfers)
}

func TestPanelTabTransferReservesOneSourceTab(t *testing.T) {
	lifecycle := newLifecycle()
	ownerWindowName := lifecycle.Add()
	panels := newPanelIndex()
	sourceSnapshot := validPanelGroupSnapshot()
	sourceSnapshot.OwnerWindowName = ownerWindowName
	sourceSnapshot.GroupID = "source-group"
	source := livePanelWindowForTabTransfer(t, panels, sourceSnapshot)
	targetSnapshot := validPanelGroupSnapshot()
	targetSnapshot.TransferID = "target-open"
	targetSnapshot.OwnerWindowName = ownerWindowName
	targetSnapshot.GroupID = "target-group"
	targetSnapshot.Tabs[0].PanelID = "target-tab"
	targetSnapshot.Tabs[0].ObjectRef.Name = "worker"
	targetSnapshot.ActivePanelID = "target-tab"
	target := livePanelWindowForTabTransfer(t, panels, targetSnapshot)
	registry := &Registry{
		lifecycle:           lifecycle,
		panels:              panels,
		pendingTabTransfers: make(map[string]*panelTabTransfer),
		emitWindowEvent:     func(string, string, any) bool { return true },
	}
	request := panelwindow.TabTransferRequest{
		TransferID:       "tab-transfer-1",
		SourceWindowName: source.WindowName,
		TargetWindowName: target.WindowName,
		OwnerWindowName:  ownerWindowName,
		ClusterID:        source.ClusterID,
		SourceGroupID:    source.GroupID,
		TargetGroupID:    target.GroupID,
		TargetKind:       panelwindow.TabTransferTargetPanelWindow,
		Tab:              sourceSnapshot.Tabs[0],
	}

	require.NoError(t, registry.RequestPanelTabTransfer(target.WindowName, request))
	request.TransferID = "tab-transfer-2"
	err := registry.RequestPanelTabTransfer(target.WindowName, request)

	require.ErrorContains(t, err, "already has a pending transfer")
	require.Len(t, registry.pendingTabTransfers, 1)
}

func TestWorkspacePanelTabTransferCommitsAfterOwnerAcceptance(t *testing.T) {
	lifecycle := newLifecycle()
	ownerWindowName := lifecycle.Add()
	panels := newPanelIndex()
	sourceSnapshot := validPanelGroupSnapshot()
	sourceSnapshot.OwnerWindowName = ownerWindowName
	sourceSnapshot.GroupID = "source-group"
	source := livePanelWindowForTabTransfer(t, panels, sourceSnapshot)
	events := make([]capturedPanelWindowEvent, 0, 3)
	registry := &Registry{
		lifecycle:           lifecycle,
		panels:              panels,
		pendingTabTransfers: make(map[string]*panelTabTransfer),
		emitWindowEvent: func(target, name string, payload any) bool {
			events = append(events, capturedPanelWindowEvent{target: target, name: name, payload: payload})
			return true
		},
	}
	request := panelwindow.TabTransferRequest{
		TransferID:       "tab-transfer-workspace",
		SourceWindowName: source.WindowName,
		TargetWindowName: ownerWindowName,
		OwnerWindowName:  ownerWindowName,
		ClusterID:        source.ClusterID,
		SourceGroupID:    source.GroupID,
		TargetGroupID:    "bottom",
		TargetKind:       panelwindow.TabTransferTargetWorkspace,
		Tab:              sourceSnapshot.Tabs[0],
	}

	require.NoError(t, registry.RequestPanelTabTransfer(ownerWindowName, request))
	require.NoError(t, registry.AcceptPanelTabTransfer(ownerWindowName, request.TransferID))

	require.Equal(t, sourceSnapshot, requirePanelDescriptor(t, panels, source.WindowName).Snapshot)
	require.Contains(t, events, capturedPanelWindowEvent{
		target: source.WindowName,
		name:   panelwindow.TabTransferCommittedEventName,
		payload: panelwindow.TabTransferCommittedEvent{
			Request: request,
		},
	})
	require.Empty(t, registry.pendingTabTransfers)
}

func TestFailNewPanelWindowTabTransferClosesItsOpeningTarget(t *testing.T) {
	wailsApp := application.New(application.Options{})
	registry := NewRegistry(wailsApp, nil)
	registry.panelOpenTimeout = 0
	registry.tabTransferTimeout = 0
	owner := registry.Create(true)
	request := panelwindow.TabTransferRequest{
		TransferID:       "tab-transfer-failed-open",
		SourceWindowName: owner.Name(),
		OwnerWindowName:  owner.Name(),
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
	require.NoError(t, registry.RequestPanelTabTransfer(owner.Name(), request))
	require.NoError(t, registry.AcceptPanelTabTransfer(owner.Name(), request.TransferID))
	snapshot := validPanelGroupSnapshot()
	snapshot.TransferID = request.TransferID
	snapshot.OwnerWindowName = request.OwnerWindowName
	snapshot.ClusterID = request.ClusterID
	snapshot.GroupID = request.TargetGroupID
	snapshot.Tabs = []panelwindow.TabSnapshot{request.Tab}
	snapshot.ActivePanelID = request.Tab.PanelID
	descriptor, err := registry.BeginPanelWindowOpen(snapshot)
	require.NoError(t, err)

	require.NoError(t, registry.FailPanelTabTransfer(owner.Name(), request.TransferID))

	require.Equal(t, descriptor.WindowName, closedWindowName)
	require.Equal(t, PanelWindowStateMissing, registry.panels.State(descriptor.WindowName))
	require.Empty(t, registry.pendingTabTransfers)
}

func TestExpiredNewWindowTabTransferRejectsLateTargetOpen(t *testing.T) {
	wailsApp := application.New(application.Options{})
	registry := NewRegistry(wailsApp, nil)
	registry.panelOpenTimeout = 0
	registry.tabTransferTimeout = 20 * time.Millisecond
	owner := registry.Create(true)
	request := panelwindow.TabTransferRequest{
		TransferID:       "tab-transfer-expired-open",
		SourceWindowName: owner.Name(),
		OwnerWindowName:  owner.Name(),
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
	require.NoError(t, registry.RequestPanelTabTransfer(owner.Name(), request))
	require.NoError(t, registry.AcceptPanelTabTransfer(owner.Name(), request.TransferID))
	select {
	case <-failed:
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for expired panel tab transfer")
	}
	require.Empty(t, registry.pendingTabTransfers)

	snapshot := validPanelGroupSnapshot()
	snapshot.TransferID = request.TransferID
	snapshot.OwnerWindowName = request.OwnerWindowName
	snapshot.ClusterID = request.ClusterID
	snapshot.GroupID = request.TargetGroupID
	snapshot.Tabs = []panelwindow.TabSnapshot{request.Tab}
	snapshot.ActivePanelID = request.Tab.PanelID
	_, err := registry.BeginPanelWindowOpen(snapshot)

	require.ErrorContains(t, err, "no longer pending")
	require.Empty(t, registry.PanelNamesOwnedByWorkspace(owner.Name()))
}

func TestPanelTabTransferTimeoutFailsAllParticipantsWithoutChangingSource(t *testing.T) {
	lifecycle := newLifecycle()
	ownerWindowName := lifecycle.Add()
	panels := newPanelIndex()
	sourceSnapshot := validPanelGroupSnapshot()
	sourceSnapshot.OwnerWindowName = ownerWindowName
	sourceSnapshot.GroupID = "source-group"
	source := livePanelWindowForTabTransfer(t, panels, sourceSnapshot)
	targetSnapshot := validPanelGroupSnapshot()
	targetSnapshot.TransferID = "target-open"
	targetSnapshot.OwnerWindowName = ownerWindowName
	targetSnapshot.GroupID = "target-group"
	targetSnapshot.Tabs[0].PanelID = "target-tab"
	targetSnapshot.Tabs[0].ObjectRef.Name = "worker"
	targetSnapshot.ActivePanelID = "target-tab"
	target := livePanelWindowForTabTransfer(t, panels, targetSnapshot)
	failedEvents := make(chan capturedPanelWindowEvent, 3)
	registry := &Registry{
		lifecycle:           lifecycle,
		panels:              panels,
		tabTransferTimeout:  20 * time.Millisecond,
		pendingTabTransfers: make(map[string]*panelTabTransfer),
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
		OwnerWindowName:  ownerWindowName,
		ClusterID:        source.ClusterID,
		SourceGroupID:    source.GroupID,
		TargetGroupID:    target.GroupID,
		TargetKind:       panelwindow.TabTransferTargetPanelWindow,
		Tab:              sourceSnapshot.Tabs[0],
	}

	require.NoError(t, registry.RequestPanelTabTransfer(target.WindowName, request))
	targets := make([]string, 0, 3)
	for range 3 {
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
	require.ElementsMatch(t, []string{source.WindowName, ownerWindowName, target.WindowName}, targets)
	require.Equal(t, sourceSnapshot, requirePanelDescriptor(t, panels, source.WindowName).Snapshot)
	require.Empty(t, registry.pendingTabTransfers)
}

func requirePanelDescriptor(
	t *testing.T,
	panels *panelIndex,
	windowName string,
) PanelWindowDescriptor {
	t.Helper()
	descriptor, err := panels.Descriptor(windowName)
	require.NoError(t, err)
	return descriptor
}
