package appwindow

import (
	"slices"
	"sync"
	"testing"
	"time"

	"github.com/luxury-yacht/app/internal/panelwindow"
	"github.com/stretchr/testify/require"
	"github.com/wailsapp/wails/v3/pkg/application"
)

type groupTransferFixture struct {
	registry *Registry
	owner    string
	snapshot PanelGroupSnapshot
	// Backend timers emit from their own goroutine.
	mu     sync.Mutex
	events []string
	closed []string
}

// The owner app window renders one docked panel whose directory entry still has
// the view it was opened with; intents may carry a newer view.
func newGroupTransferFixture(t *testing.T) *groupTransferFixture {
	t.Helper()
	fixture := &groupTransferFixture{}
	fixture.registry = NewRegistry(application.New(application.Options{}), &recordingLifecycleBackend{})
	fixture.owner = fixture.registry.Create(true).Name()
	fixture.snapshot = validPanelGroupSnapshot()
	fixture.snapshot.SourceWindowName = fixture.owner
	_, _, err := fixture.registry.workspace.Open(fixture.snapshot.Tabs[0], panelwindow.PanelLocation{Kind: panelwindow.PanelLocationDocked, WindowName: fixture.owner, GroupID: "right"})
	require.NoError(t, err)
	require.NoError(t, fixture.registry.AcknowledgePanelWorkspaceReady(fixture.owner))
	// Mounted and published, so only transfer state (not an unmounted claim)
	// can protect the panel from a later snapshot.
	require.NoError(t, fixture.registry.PublishDockedPanels(fixture.owner, fixture.docked(t)))
	fixture.registry.showWindow = func(string) bool { return true }
	fixture.registry.closeWindow = func(name string) bool { fixture.closed = append(fixture.closed, name); return true }
	fixture.registry.emitWindowEvent = func(target, name string, _ any) bool {
		fixture.mu.Lock()
		defer fixture.mu.Unlock()
		fixture.events = append(fixture.events, target+":"+name)
		return true
	}
	return fixture
}

func (f *groupTransferFixture) resetEvents() {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.events = nil
}

func (f *groupTransferFixture) sawEvent(event string) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	return slices.Contains(f.events, event)
}

func (f *groupTransferFixture) panel(t *testing.T) panelwindow.WorkspacePanel {
	t.Helper()
	panels := f.registry.workspace.Snapshot(f.snapshot.ClusterID).Panels
	require.Len(t, panels, 1, "a transfer must never lose or duplicate the panel")
	return panels[0]
}

func (f *groupTransferFixture) beginFloat(t *testing.T) PanelWindowDescriptor {
	t.Helper()
	floated := f.snapshot
	floated.Tabs = append([]PanelTabSnapshot(nil), f.snapshot.Tabs...)
	floated.Tabs[0].ActiveView = "yaml"
	descriptor, err := f.registry.BeginPanelWindowOpen(floated)
	require.NoError(t, err, "the directory validates identity; an unpublished view change needs no flush")
	return descriptor
}

func (f *groupTransferFixture) float(t *testing.T) PanelWindowDescriptor {
	t.Helper()
	descriptor := f.beginFloat(t)
	_, err := f.registry.AcknowledgePanelWindowReady(descriptor.WindowName, f.snapshot.TransferID)
	require.NoError(t, err)
	return descriptor
}

func (f *groupTransferFixture) beginDock(t *testing.T, native PanelWindowDescriptor, position string) PanelGroupSnapshot {
	t.Helper()
	dock := f.snapshot
	dock.Tabs = append([]PanelTabSnapshot(nil), f.snapshot.Tabs...)
	dock.Tabs[0].ActiveView = "events"
	dock.SourceWindowName = native.WindowName
	dock.GroupID = native.GroupID
	dock.TransferID = "dock-" + position
	f.resetEvents()
	require.NoError(t, f.registry.BeginPanelWindowDock(native.WindowName, position, dock))
	return dock
}

func (f *groupTransferFixture) docked(t *testing.T) []panelwindow.WorkspaceGroup {
	return []panelwindow.WorkspaceGroup{{ClusterID: f.snapshot.ClusterID, GroupID: "right", Tabs: f.snapshot.Tabs, ActivePanelID: f.snapshot.ActivePanelID}}
}

func TestFloatKeepsSourceUntilReadyAndSurvivesStaleSourcePublications(t *testing.T) {
	fixture := newGroupTransferFixture(t)
	descriptor := fixture.beginFloat(t)

	pending := fixture.panel(t)
	require.Equal(t, fixture.owner, pending.Location.WindowName)
	require.Equal(t, descriptor.WindowName, pending.Transfer.Target.WindowName)
	// A source snapshot queued before the intent lands while the group moves.
	require.NoError(t, fixture.registry.PublishDockedPanels(fixture.owner, nil))
	require.Equal(t, fixture.owner, fixture.panel(t).Location.WindowName)

	_, err := fixture.registry.AcknowledgePanelWindowReady(descriptor.WindowName, fixture.snapshot.TransferID)
	require.NoError(t, err)
	committed := fixture.panel(t)
	require.Equal(t, panelwindow.PanelLocation{Kind: panelwindow.PanelLocationWindow, WindowName: descriptor.WindowName, GroupID: fixture.snapshot.GroupID, Active: true}, committed.Location)
	require.Equal(t, "yaml", committed.Tab.ActiveView)
	require.Zero(t, committed.Transfer)

	// The same stale snapshot arriving after commit cannot pull the tab back.
	require.NoError(t, fixture.registry.PublishDockedPanels(fixture.owner, fixture.docked(t)))
	require.Equal(t, descriptor.WindowName, fixture.panel(t).Location.WindowName)
}

func TestFailedFloatKeepsSourcePlacementWithoutPinningIt(t *testing.T) {
	for _, failure := range []string{"window disappears before ready", "open times out", "window cannot be created"} {
		t.Run(failure, func(t *testing.T) {
			fixture := newGroupTransferFixture(t)
			switch failure {
			case "window disappears before ready":
				descriptor := fixture.beginFloat(t)
				fixture.registry.showWindow = func(string) bool { return false }
				_, err := fixture.registry.AcknowledgePanelWindowReady(descriptor.WindowName, fixture.snapshot.TransferID)
				require.Error(t, err)
			case "open times out":
				descriptor := fixture.beginFloat(t)
				fixture.registry.expirePanelOpen(descriptor.WindowName, fixture.snapshot.TransferID)
			case "window cannot be created":
				fixture.registry.newWindow = func(application.WebviewWindowOptions) *application.WebviewWindow { return nil }
				_, err := fixture.registry.BeginPanelWindowOpen(fixture.snapshot)
				require.Error(t, err)
			}

			kept := fixture.panel(t)
			require.Equal(t, fixture.owner, kept.Location.WindowName)
			require.Zero(t, kept.Transfer)
			require.NoError(t, fixture.registry.ClosePanelWorkspaceObject(fixture.owner, fixture.snapshot.ClusterID, fixture.snapshot.Tabs[0].PanelID))
			require.Empty(t, fixture.registry.workspace.Snapshot(fixture.snapshot.ClusterID).Panels, "the source can close a panel whose float failed")
		})
	}
}

func TestDockBackTargetLearnsFromTheDirectoryAndCommitsAfterTheSourceCloses(t *testing.T) {
	fixture := newGroupTransferFixture(t)
	native := fixture.float(t)
	dock := fixture.beginDock(t, native, "bottom")

	require.True(t, fixture.sawEvent(fixture.owner+":"+panelwindow.WorkspaceChangedEventName))
	pending := fixture.panel(t)
	require.Equal(t, native.WindowName, pending.Location.WindowName)
	require.Equal(t, panelwindow.PanelLocation{Kind: panelwindow.PanelLocationDocked, WindowName: fixture.owner, GroupID: "bottom", Active: true}, pending.Transfer.Target)
	// The target mounts its provisional copy and publishes before acknowledging.
	provisional := []panelwindow.WorkspaceGroup{{ClusterID: dock.ClusterID, GroupID: "bottom", Tabs: dock.Tabs, ActivePanelID: dock.ActivePanelID}}
	require.NoError(t, fixture.registry.PublishDockedPanels(fixture.owner, provisional))
	require.Equal(t, native.WindowName, fixture.panel(t).Location.WindowName)

	require.NoError(t, fixture.registry.AcknowledgePanelTransfer(fixture.owner, dock.TransferID, true))
	committed := fixture.panel(t)
	require.Equal(t, panelwindow.PanelLocation{Kind: panelwindow.PanelLocationDocked, WindowName: fixture.owner, GroupID: "bottom", Active: true}, committed.Location)
	require.Equal(t, "events", committed.Tab.ActiveView)
	require.Equal(t, []string{native.WindowName}, fixture.closed)
	require.Equal(t, PanelWindowStateMissing, fixture.registry.panels.State(native.WindowName))
}

func TestFailedDockKeepsNativeSourceAndTellsTheTargetToDropItsCopy(t *testing.T) {
	for _, failure := range []string{"source cannot close", "dock times out", "target rejects"} {
		t.Run(failure, func(t *testing.T) {
			fixture := newGroupTransferFixture(t)
			native := fixture.float(t)
			if failure == "dock times out" {
				fixture.registry.panelDockTimeout = time.Millisecond
			}
			dock := fixture.beginDock(t, native, "right")

			switch failure {
			case "source cannot close":
				fixture.resetEvents()
				fixture.registry.closeWindow = func(string) bool { return false }
				require.Error(t, fixture.registry.AcknowledgePanelTransfer(fixture.owner, dock.TransferID, true))
			case "target rejects":
				fixture.resetEvents()
				require.NoError(t, fixture.registry.AcknowledgePanelTransfer(fixture.owner, dock.TransferID, false))
			case "dock times out":
				// The backend's own timer cancels a dock its target never answers.
				require.Eventually(t, func() bool {
					return fixture.sawEvent(fixture.owner + ":" + panelwindow.WindowTransferFailedEventName)
				}, time.Second, time.Millisecond)
			}

			kept := fixture.panel(t)
			require.Equal(t, native.WindowName, kept.Location.WindowName)
			require.Zero(t, kept.Transfer)
			require.Equal(t, PanelWindowStateLive, fixture.registry.panels.State(native.WindowName))
			require.True(t, fixture.sawEvent(fixture.owner+":"+panelwindow.WorkspaceChangedEventName), "the target re-reads and drops its provisional copy")
			require.Error(t, fixture.registry.workspace.CommitGroupTransfer(dock.TransferID))
		})
	}
}

func TestClosingTheNativeSourceDuringDockLeavesNoPinnedPanels(t *testing.T) {
	fixture := newGroupTransferFixture(t)
	native := fixture.float(t)
	dock := fixture.beginDock(t, native, "right")

	require.NoError(t, fixture.registry.AcknowledgePanelWindowClose(native.WindowName))

	require.Empty(t, fixture.registry.workspace.Snapshot(fixture.snapshot.ClusterID).Panels)
	require.Error(t, fixture.registry.AcknowledgePanelTransfer(fixture.owner, dock.TransferID, true))
	require.Error(t, fixture.registry.workspace.CommitGroupTransfer(dock.TransferID))
}

func TestStaleDockIntentLeavesTheNativeSourceUsable(t *testing.T) {
	fixture := newGroupTransferFixture(t)
	native := fixture.float(t)
	stale := fixture.snapshot
	stale.Tabs = append([]PanelTabSnapshot(nil), fixture.snapshot.Tabs...)
	stale.Tabs[0].ObjectRef.Name = "closed-elsewhere"
	stale.SourceWindowName = native.WindowName
	stale.GroupID = native.GroupID
	stale.TransferID = "stale-dock"

	require.Error(t, fixture.registry.BeginPanelWindowDock(native.WindowName, "right", stale))

	require.Equal(t, PanelWindowStateLive, fixture.registry.panels.State(native.WindowName))
	require.Zero(t, fixture.panel(t).Transfer)
	fixture.beginDock(t, native, "bottom")
}
