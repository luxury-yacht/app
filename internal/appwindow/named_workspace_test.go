package appwindow

import (
	"context"
	"errors"
	"testing"

	"github.com/luxury-yacht/app/internal/panelwindow"
	"github.com/stretchr/testify/require"
	"github.com/wailsapp/wails/v3/pkg/application"
)

func TestNamedWorkspaceRestoreKeepsCurrentWindowsWhenCloseIsDenied(t *testing.T) {
	r := NewRegistry(nil, &recordingLifecycleBackend{})
	name := r.lifecycle.Add()
	r.markWorkspaceReady(name)
	r.emitWindowEvent = func(window, event string, data any) bool {
		if event == panelwindow.ApplicationQuitPreflightRequestedEventName {
			request := data.(panelwindow.ApplicationQuitPreflightRequestedEvent)
			require.NoError(t, r.AcknowledgeApplicationQuitPreflight(window, request.TransactionID, false))
		}
		return true
	}
	err := r.OpenNamedWorkspace(context.Background(), name, panelwindow.NamedWorkspace{})
	require.ErrorIs(t, err, errNamedWorkspaceOpenCancelled)
	require.True(t, r.lifecycle.Contains(name))
	require.Nil(t, r.pendingQuit)
	require.False(t, errors.Is(err, context.DeadlineExceeded))
}

func TestNamedWorkspaceRestoreKeepsCurrentWindowsWhenStagingFails(t *testing.T) {
	r := NewRegistry(nil, &recordingLifecycleBackend{})
	name := r.lifecycle.Add()
	r.markWorkspaceReady(name)
	r.newWindow = func(application.WebviewWindowOptions) *application.WebviewWindow { return nil }
	r.closeWindow = func(name string) bool { return false }
	r.emitWindowEvent = func(window, event string, data any) bool {
		if event == panelwindow.ApplicationQuitPreflightRequestedEventName {
			request := data.(panelwindow.ApplicationQuitPreflightRequestedEvent)
			require.NoError(t, r.AcknowledgeApplicationQuitPreflight(window, request.TransactionID, true))
		}
		return true
	}
	err := r.OpenNamedWorkspace(context.Background(), name, panelwindow.NamedWorkspace{
		AppWindows: []panelwindow.NamedWorkspaceAppWindow{{Geometry: panelwindow.NamedWorkspaceGeometry{
			WindowBounds: panelwindow.WindowBounds{Width: 1100, Height: 800},
		}}},
	})
	require.ErrorContains(t, err, "could not create app window")
	require.Equal(t, []string{name}, r.lifecycle.Names())
	require.Nil(t, r.pendingQuit)
	_, staged := r.workspaceRestoreSlots.Load("workspace-2")
	require.False(t, staged)
}

func TestNamedWorkspaceReplacesWindowsAfterDestinationAcknowledges(t *testing.T) {
	app := application.New(application.Options{})
	panel := validPanelGroupSnapshot()
	r := NewRegistry(app, &recordingLifecycleBackend{
		windowClusters: map[string][]string{}, availableWorkspaceClusters: []string{panel.ClusterID},
	})
	source := r.Create(false).Name()
	// The fixture creates Wails window objects without running the native event loop.
	r.application = nil
	r.markWorkspaceReady(source)
	_, _, err := r.workspace.Open(panel.Tabs[0], panelwindow.PanelLocation{
		WindowName: source, GroupID: "right", Kind: panelwindow.PanelLocationDocked, Active: true,
	})
	require.NoError(t, err)
	newWindow := r.newWindow
	r.newWindow = func(options application.WebviewWindowOptions) *application.WebviewWindow {
		require.True(t, options.Hidden)
		require.True(t, r.lifecycle.Contains(source))
		window := newWindow(options)
		if options.Name == "panel-1" {
			descriptor, err := r.PanelDescriptor(options.Name)
			require.NoError(t, err)
			require.Equal(t, panel.Tabs, descriptor.Group.Tabs)
			_, err = r.AcknowledgePanelWindowReady(options.Name, descriptor.TransferID)
			require.NoError(t, err)
		} else {
			require.NoError(t, r.AcknowledgePanelWorkspaceReady(options.Name))
		}
		return window
	}
	r.emitWindowEvent = func(window, event string, data any) bool {
		switch event {
		case panelwindow.ApplicationQuitPreflightRequestedEventName:
			request := data.(panelwindow.ApplicationQuitPreflightRequestedEvent)
			require.True(t, request.SwitchingWorkspace)
			require.NoError(t, r.AcknowledgeApplicationQuitPreflight(window, request.TransactionID, true))
		case panelwindow.NamedWorkspaceRestoreRequested:
			request := data.(panelwindow.NamedWorkspaceRestoreRequest)
			require.Equal(t, "workspace-2", request.WindowName)
			require.True(t, r.lifecycle.Contains(source))
			require.NotSame(t, r.workspace, r.workspaceDirectoryFor(window))
			require.NoError(t, r.AcknowledgeNamedWorkspaceRestore(window, ""))
		}
		return true
	}
	var shown []string
	r.showWindow = func(window string) bool { shown = append(shown, window); return true }
	r.closeWindow = func(window string) bool { r.handleClosing(nil, window); return true }
	geometry := panelwindow.NamedWorkspaceGeometry{WindowBounds: panelwindow.WindowBounds{Width: 1100, Height: 800}}
	require.NoError(t, r.OpenNamedWorkspace(context.Background(), source, panelwindow.NamedWorkspace{
		AppWindows: []panelwindow.NamedWorkspaceAppWindow{{Geometry: geometry}},
		PanelWindows: []panelwindow.NamedWorkspacePanelWindow{{Geometry: geometry, Group: panelwindow.WorkspaceGroup{
			ClusterID: panel.ClusterID, GroupID: panel.GroupID, Tabs: panel.Tabs, ActivePanelID: panel.ActivePanelID,
		}}},
	}))
	require.Equal(t, []string{"workspace-2", "panel-1"}, shown)
	require.Equal(t, []string{"workspace-2"}, r.lifecycle.Names())
	require.Same(t, r.workspace, r.workspaceDirectoryFor("workspace-2"))
	require.Equal(t, "panel-1", r.workspace.Snapshot(panel.ClusterID).Panels[0].Location.WindowName)
	require.Nil(t, r.pendingQuit)
}

func TestNamedWorkspaceMissingClusterPreservesAvailableViews(t *testing.T) {
	snapshot := panelwindow.NamedWorkspace{AppWindows: []panelwindow.NamedWorkspaceAppWindow{{
		SelectedClusterID: "missing",
		ClusterTabs:       []panelwindow.NamedWorkspaceClusterTab{{ClusterID: "missing"}, {ClusterID: "available"}},
		GlobalView:        &panelwindow.NamedWorkspaceGlobalView{View: "fleet"},
	}}, PanelWindows: []panelwindow.NamedWorkspacePanelWindow{{Group: panelwindow.WorkspaceGroup{ClusterID: "missing"}}}}
	restored, missing := availableWorkspaceLayout(snapshot, []string{"available"})
	require.Equal(t, []string{"missing"}, missing)
	require.Equal(t, "available", restored.AppWindows[0].SelectedClusterID)
	require.Equal(t, []string{"available"}, workspaceClusterIDs(restored.AppWindows[0]))
	require.Nil(t, restored.AppWindows[0].GlobalView)
	require.Empty(t, restored.PanelWindows)
	require.Len(t, snapshot.AppWindows[0].ClusterTabs, 2)
}

func TestCaptureNamedWorkspaceWaitsForEveryAppWindow(t *testing.T) {
	registry := NewRegistry(nil, &recordingLifecycleBackend{windowClusters: map[string][]string{}})
	first, second := registry.lifecycle.Add(), registry.lifecycle.Add()
	registry.markWorkspaceReady(first)
	registry.windowGeometry = func(name string) (geometry, bool) {
		return geometry{Width: 900, Height: 700}, true
	}
	var requested []string
	registry.emitWindowEvent = func(name, _ string, payload any) bool {
		requested = append(requested, name)
		request := payload.(panelwindow.NamedWorkspaceCaptureRequest)
		require.Error(t, registry.SubmitNamedWorkspaceCapture(name, "stale-id", panelwindow.NamedWorkspaceAppWindow{}))
		require.NoError(t, registry.SubmitNamedWorkspaceCapture(name, request.ID, panelwindow.NamedWorkspaceAppWindow{}))
		return true
	}
	_, err := registry.CaptureNamedWorkspace(context.Background(), first)
	require.Error(t, err)
	require.Empty(t, requested)
	registry.markWorkspaceReady(second)
	workspace, err := registry.CaptureNamedWorkspace(context.Background(), first)
	require.NoError(t, err)
	require.Equal(t, []string{first, second}, requested)
	require.Len(t, workspace.AppWindows, 2)
	require.Equal(t, 900, workspace.AppWindows[1].Geometry.Width)
}

func TestCaptureNamedWorkspaceRejectsAWindowClosingDuringCapture(t *testing.T) {
	registry := NewRegistry(nil, &recordingLifecycleBackend{windowClusters: map[string][]string{}})
	first, second := registry.lifecycle.Add(), registry.lifecycle.Add()
	registry.markWorkspaceReady(first)
	registry.markWorkspaceReady(second)
	registry.windowGeometry = func(string) (geometry, bool) {
		return geometry{Width: 900, Height: 700}, true
	}
	registry.emitWindowEvent = func(name, _ string, payload any) bool {
		request := payload.(panelwindow.NamedWorkspaceCaptureRequest)
		require.NoError(t, registry.SubmitNamedWorkspaceCapture(name, request.ID, panelwindow.NamedWorkspaceAppWindow{}))
		if name == second {
			registry.lifecycle.BeginClose(second)
		}
		return true
	}
	_, err := registry.CaptureNamedWorkspace(context.Background(), first)
	require.ErrorContains(t, err, "windows changed")
	workspace, err := registry.CaptureNamedWorkspace(context.Background(), first)
	require.NoError(t, err)
	require.Len(t, workspace.AppWindows, 1)
}

func TestCaptureNamedWorkspaceKeepsDockedAndFloatingPanels(t *testing.T) {
	snapshot := twoTabPanelGroupSnapshot()
	registry, panel := liveNativeWindow(t, snapshot)
	app := registry.lifecycle.Add()
	registry.markWorkspaceReady(app)
	registry.backend = &recordingLifecycleBackend{windowClusters: map[string][]string{app: {snapshot.ClusterID}}}
	registry.windowGeometry = func(name string) (geometry, bool) {
		return geometry{AbsoluteX: -100, Width: 900, Height: 700}, true
	}
	dockedTab := snapshot.Tabs[0]
	dockedTab.PanelID = "dock-tab"
	dockedTab.ObjectRef.Name = "docked-object"
	_, _, err := registry.workspace.Open(dockedTab, panelwindow.PanelLocation{Kind: panelwindow.PanelLocationDocked, WindowName: app, GroupID: "right", Active: true})
	require.NoError(t, err)
	registry.emitWindowEvent = func(name, _ string, payload any) bool {
		request := payload.(panelwindow.NamedWorkspaceCaptureRequest)
		state := panelwindow.NamedWorkspaceAppWindow{}
		if name == app {
			state.ClusterTabs = []panelwindow.NamedWorkspaceClusterTab{{ClusterID: snapshot.ClusterID}}
			state.DockedGroups = []panelwindow.NamedWorkspaceDockedGroup{{Group: panelwindow.WorkspaceGroup{
				GroupID: "right", ClusterID: snapshot.ClusterID, ActivePanelID: dockedTab.PanelID, Tabs: []panelwindow.TabSnapshot{dockedTab},
			}}}
		} else {
			require.Equal(t, panel, name)
		}
		require.NoError(t, registry.SubmitNamedWorkspaceCapture(name, request.ID, state))
		return true
	}
	workspace, err := registry.CaptureNamedWorkspace(context.Background(), app)
	require.NoError(t, err)
	require.Equal(t, []panelwindow.TabSnapshot{dockedTab}, workspace.AppWindows[0].DockedGroups[0].Group.Tabs)
	require.Equal(t, snapshot.Tabs, workspace.PanelWindows[0].Group.Tabs)
	require.Equal(t, -100, workspace.PanelWindows[0].Geometry.X)
}
