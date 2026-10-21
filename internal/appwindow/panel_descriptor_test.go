package appwindow

import (
	"testing"

	"github.com/luxury-yacht/app/internal/panelwindow"
	"github.com/stretchr/testify/require"
	"github.com/wailsapp/wails/v3/pkg/application"
)

func twoTabPanelGroupSnapshot() PanelGroupSnapshot {
	snapshot := validPanelGroupSnapshot()
	second := snapshot.Tabs[0]
	second.PanelID = "panel-tab-2"
	second.ObjectRef.Name = "web"
	snapshot.Tabs = append(snapshot.Tabs, second)
	snapshot.ActivePanelID = second.PanelID
	return snapshot
}

// liveNativeWindow returns a registry with one live native window whose group
// the directory places in it.
func liveNativeWindow(t *testing.T, snapshot PanelGroupSnapshot) (*Registry, string) {
	t.Helper()
	registry := &Registry{lifecycle: newLifecycle(), panels: newPanelIndex(), workspace: panelwindow.NewWorkspaceDirectory(), emitWindowEvent: func(string, string, any) bool { return true }}
	native, err := registry.panels.BeginOpen(snapshot)
	require.NoError(t, err)
	_, err = registry.panels.AcknowledgeOpen(native.WindowName, snapshot.TransferID)
	require.NoError(t, err)
	seedNativeGroup(t, registry.workspace, native.WindowName, snapshot)
	return registry, native.WindowName
}

// nativeDescriptorTabs reads the tabs and active tab a native window's renderer
// mounts from its descriptor.
func nativeDescriptorTabs(t *testing.T, registry *Registry, windowName string) ([]string, string) {
	t.Helper()
	descriptor, err := registry.PanelDescriptor(windowName)
	require.NoError(t, err)
	ids := make([]string, 0, len(descriptor.Group.Tabs))
	for _, tab := range descriptor.Group.Tabs {
		ids = append(ids, tab.PanelID)
	}
	return ids, descriptor.Group.ActivePanelID
}

// publishNativeGroup sends a native window's arrangement report.
func publishNativeGroup(t *testing.T, registry *Registry, windowName string, snapshot PanelGroupSnapshot) {
	t.Helper()
	snapshot.SourceWindowName = windowName
	require.NoError(t, registry.PublishPanelWindowGroup(windowName, nativeGroup(snapshot)))
}

// A stale or buggy native report can name a panel the directory places in
// another window. The native window must never treat it as its own: its
// descriptor omits it and it cannot authorize that panel's close.
func TestNativeWindowNeverClaimsAForeignPanelFromItsReport(t *testing.T) {
	snapshot := validPanelGroupSnapshot()
	registry, native := liveNativeWindow(t, snapshot)
	foreign := snapshot.Tabs[0]
	foreign.PanelID = "foreign"
	foreign.ObjectRef.Name = "foreign"
	_, _, err := registry.workspace.Open(foreign, panelwindow.PanelLocation{Kind: panelwindow.PanelLocationDocked, WindowName: "workspace-other", GroupID: "right"})
	require.NoError(t, err)

	report := snapshot
	report.Tabs = append(append([]PanelTabSnapshot(nil), snapshot.Tabs...), foreign)
	publishNativeGroup(t, registry, native, report)

	tabs, _ := nativeDescriptorTabs(t, registry, native)
	require.Equal(t, []string{"panel-tab-1"}, tabs)
	require.ErrorContains(t, registry.RequestPanelTabClose(native, foreign.PanelID), "not in window")
}

// A native window's tabs are the directory's: a close intent removes the tab
// from the descriptor at once, without waiting for the window's next report.
func TestNativeDescriptorFollowsDirectoryCloseAndArrangement(t *testing.T) {
	snapshot := twoTabPanelGroupSnapshot()
	registry, native := liveNativeWindow(t, snapshot)

	reordered := snapshot
	reordered.Tabs = []PanelTabSnapshot{snapshot.Tabs[1], snapshot.Tabs[0]}
	reordered.ActivePanelID = "panel-tab-1"
	publishNativeGroup(t, registry, native, reordered)
	tabs, active := nativeDescriptorTabs(t, registry, native)
	require.Equal(t, []string{"panel-tab-2", "panel-tab-1"}, tabs)
	require.Equal(t, "panel-tab-1", active)

	require.NoError(t, registry.ClosePanelWorkspaceObject(native, snapshot.ClusterID, "panel-tab-1"))
	tabs, active = nativeDescriptorTabs(t, registry, native)
	require.Equal(t, []string{"panel-tab-2"}, tabs)
	require.Equal(t, "panel-tab-2", active)
	require.ErrorContains(t, registry.RequestPanelTabClose(native, "panel-tab-1"), "not in window")
}

// While a native window opens, the directory still places the group in its
// source. The new renderer mounts the tabs moving into it, in order.
func TestOpeningNativeDescriptorListsTheIncomingGroup(t *testing.T) {
	registry := NewRegistry(application.New(application.Options{}), &recordingLifecycleBackend{})
	appName := registry.Create(true).Name()
	snapshot := twoTabPanelGroupSnapshot()
	snapshot.SourceWindowName = appName
	descriptor, err := beginTestPanelWindow(t, registry, snapshot)
	require.NoError(t, err)
	require.Equal(t, PanelWindowStateOpening, descriptor.State)

	tabs, active := nativeDescriptorTabs(t, registry, descriptor.WindowName)
	require.Equal(t, []string{"panel-tab-1", "panel-tab-2"}, tabs)
	require.Equal(t, "panel-tab-2", active)
	require.Equal(t, appName, registry.workspace.Snapshot(snapshot.ClusterID).Panels[0].Location.WindowName)
}

// Only a native transfer's participants settle it. Another app view showing
// the cluster can neither cancel an opening window nor commit or cancel a
// dock-back (its panels would land in, or be lost to, the wrong view).
func TestOnlyANativeTransfersParticipantsSettleIt(t *testing.T) {
	registry := NewRegistry(application.New(application.Options{}), &recordingLifecycleBackend{})
	owner := registry.Create(true).Name()
	other := registry.Create(true).Name()
	snapshot := validPanelGroupSnapshot()
	snapshot.SourceWindowName = owner
	descriptor, err := beginTestPanelWindow(t, registry, snapshot)
	require.NoError(t, err)
	registry.emitWindowEvent = func(string, string, any) bool { return true }
	registry.showWindow = func(string) bool { return true }
	var closed []string
	registry.closeWindow = func(name string) bool { closed = append(closed, name); return true }

	require.Error(t, registry.FailPanelWindowTransfer(other, descriptor.WindowName, snapshot.TransferID))
	require.Equal(t, PanelWindowStateOpening, registry.panels.State(descriptor.WindowName))
	_, err = registry.AcknowledgePanelWindowReady(descriptor.WindowName, snapshot.TransferID)
	require.NoError(t, err)

	dock := snapshot
	dock.SourceWindowName = descriptor.WindowName
	dock.TransferID = "dock-transfer"
	require.NoError(t, registry.BeginPanelWindowDock(descriptor.WindowName, "right", dock))
	target := registry.workspace.Snapshot(snapshot.ClusterID).Panels[0].Transfer.Target.WindowName
	stray := other
	if target == other {
		stray = owner
	}
	require.ErrorContains(t, registry.AcknowledgePanelTransfer(stray, dock.TransferID, true), "does not match")
	require.Error(t, registry.AcknowledgePanelTransfer(stray, dock.TransferID, false))
	require.Empty(t, closed)
	require.Equal(t, PanelWindowStateDocking, registry.panels.State(descriptor.WindowName))

	require.NoError(t, registry.AcknowledgePanelTransfer(target, dock.TransferID, true))
	require.Equal(t, target, registry.workspace.Snapshot(snapshot.ClusterID).Panels[0].Location.WindowName)
}
