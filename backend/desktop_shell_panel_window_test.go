package backend

import (
	"testing"

	"github.com/luxury-yacht/app/internal/panelwindow"
	"github.com/stretchr/testify/require"
)

func TestPanelWindowCommandsFailWhenTheNativeRegistryIsUnavailable(t *testing.T) {
	shell := NewDesktopShell(nil, nil, nil, nil)
	snapshot := panelwindow.GroupSnapshot{OwnerWindowName: "workspace-1"}

	_, err := shell.GetNativeWindowDescriptor("workspace-1")
	require.ErrorContains(t, err, "panel-window registry is not available")
	_, err = shell.BeginPanelWindowOpen("workspace-1", snapshot)
	require.ErrorContains(t, err, "panel-window registry is not available")
	_, err = shell.AcknowledgePanelWindowReady("panel-1", "transfer-1")
	require.ErrorContains(t, err, "panel-window registry is not available")
	require.ErrorContains(t, shell.BeginPanelWindowDock("panel-1", "right", snapshot), "panel-window registry is not available")
	require.ErrorContains(t, shell.AcknowledgePanelWindowDock("workspace-1", "panel-1", "transfer-1"), "panel-window registry is not available")
	require.ErrorContains(t, shell.FailPanelWindowTransfer("workspace-1", "panel-1", "transfer-1"), "panel-window registry is not available")
	require.ErrorContains(t, shell.FocusPanelWindow("workspace-1", "panel-1", "panel-a"), "panel-window registry is not available")
	require.ErrorContains(t, shell.RequestPanelWindowClose("workspace-1", "panel-1", "cluster-close"), "panel-window registry is not available")
	require.ErrorContains(t, shell.AcknowledgePanelWindowClose("panel-1"), "panel-window registry is not available")
	require.ErrorContains(t, shell.RequestClosePanelWindowsForCluster("workspace-1", "cluster-1"), "panel-window registry is not available")
	require.ErrorContains(t, shell.AcknowledgeWorkspaceWindowClose("workspace-1"), "panel-window registry is not available")
	require.ErrorContains(t, shell.RequestPanelWindowGuard("workspace-1", "panel-1", "guard-1", "application-quit"), "panel-window registry is not available")
	require.ErrorContains(t, shell.AcknowledgePanelWindowGuard("panel-1", "guard-1", true), "panel-window registry is not available")
	require.ErrorContains(t, shell.AcknowledgeApplicationQuitPreflight("workspace-1", "quit-1", true), "panel-window registry is not available")
}

func TestPanelWindowCommandsDelegateBeforeWorkspaceRuntimeReadiness(t *testing.T) {
	snapshot := panelwindow.GroupSnapshot{OwnerWindowName: "workspace-1"}
	wantNative := panelwindow.NativeDescriptor{
		SchemaVersion: panelwindow.NativeDescriptorSchemaVersion,
		Role:          panelwindow.NativeRoleWorkspace,
	}
	wantPanel := panelwindow.WindowDescriptor{WindowName: "panel-1"}
	var opened panelwindow.GroupSnapshot
	var acknowledged [2]string
	shell := NewDesktopShell(nil, func() bool { return false }, nil, nil, DesktopShellBindings{
		NativeWindowDescriptor: func(windowName string) (panelwindow.NativeDescriptor, error) {
			require.Equal(t, "workspace-1", windowName)
			return wantNative, nil
		},
		BeginPanelWindowOpen: func(got panelwindow.GroupSnapshot) (panelwindow.WindowDescriptor, error) {
			opened = got
			return wantPanel, nil
		},
		AcknowledgePanelReady: func(windowName, transferID string) (panelwindow.WindowDescriptor, error) {
			acknowledged = [2]string{windowName, transferID}
			return wantPanel, nil
		},
	})

	native, err := shell.GetNativeWindowDescriptor("workspace-1")
	require.NoError(t, err)
	require.Equal(t, wantNative, native)
	created, err := shell.BeginPanelWindowOpen("workspace-1", snapshot)
	require.NoError(t, err)
	require.Equal(t, wantPanel, created)
	require.Equal(t, snapshot, opened)
	ready, err := shell.AcknowledgePanelWindowReady("panel-1", "transfer-1")
	require.NoError(t, err)
	require.Equal(t, wantPanel, ready)
	require.Equal(t, [2]string{"panel-1", "transfer-1"}, acknowledged)

	_, err = shell.BeginPanelWindowOpen("workspace-2", snapshot)
	require.ErrorContains(t, err, "does not match source window")
}

func TestDesktopServiceDelegatesEveryPanelWindowCommandThroughTheShellOwner(t *testing.T) {
	called := 0
	mark := func() { called++ }
	native := panelwindow.NativeDescriptor{SchemaVersion: panelwindow.NativeDescriptorSchemaVersion}
	window := panelwindow.WindowDescriptor{WindowName: "panel-1"}
	shell := NewDesktopShell(nil, nil, nil, nil, DesktopShellBindings{
		NativeWindowDescriptor: func(string) (panelwindow.NativeDescriptor, error) {
			mark()
			return native, nil
		},
		BeginPanelWindowOpen: func(panelwindow.GroupSnapshot) (panelwindow.WindowDescriptor, error) {
			mark()
			return window, nil
		},
		AcknowledgePanelReady: func(string, string) (panelwindow.WindowDescriptor, error) {
			mark()
			return window, nil
		},
		BeginPanelWindowDock:      func(string, string, panelwindow.GroupSnapshot) error { mark(); return nil },
		AcknowledgePanelDock:      func(string, string, string) error { mark(); return nil },
		FailPanelTransfer:         func(string, string, string) error { mark(); return nil },
		FocusPanelWindow:          func(string, string, string) error { mark(); return nil },
		RequestPanelClose:         func(string, string, string) error { mark(); return nil },
		AcknowledgePanelClose:     func(string) error { mark(); return nil },
		RequestClusterPanelsClose: func(string, string) error { mark(); return nil },
		AcknowledgeWorkspaceClose: func(string) error { mark(); return nil },
		RoutePanelCommand:         func(string, string) error { mark(); return nil },
		RequestPanelObjectOpen: func(string, panelwindow.ObjectReference, string) error {
			mark()
			return nil
		},
		AuthorizePanelObjectOpen: func(string, string, string, panelwindow.ObjectReference, string) error {
			mark()
			return nil
		},
		UpdatePanelSnapshot:        func(string, panelwindow.GroupSnapshot) error { mark(); return nil },
		RequestPanelTabClose:       func(string, string) error { mark(); return nil },
		AuthorizePanelTabClose:     func(string, string, string) error { mark(); return nil },
		RequestPanelGuard:          func(string, string, string, string) error { mark(); return nil },
		AcknowledgePanelGuard:      func(string, string, bool) error { mark(); return nil },
		AcknowledgeApplicationQuit: func(string, string, bool) error { mark(); return nil },
	})
	service := NewDesktopService(DesktopServiceDependencies{PanelWindows: shell})
	snapshot := panelwindow.GroupSnapshot{OwnerWindowName: "workspace-1"}
	ref := panelwindow.ObjectReference{ClusterID: "cluster-1"}

	gotNative, err := service.GetNativeWindowDescriptor("workspace-1")
	require.NoError(t, err)
	require.Equal(t, native, gotNative)
	gotWindow, err := service.BeginPanelWindowOpen("workspace-1", snapshot)
	require.NoError(t, err)
	require.Equal(t, window, gotWindow)
	gotWindow, err = service.AcknowledgePanelWindowReady("panel-1", "transfer-1")
	require.NoError(t, err)
	require.Equal(t, window, gotWindow)
	require.NoError(t, service.BeginPanelWindowDock("panel-1", "right", snapshot))
	require.NoError(t, service.AcknowledgePanelWindowDock("workspace-1", "panel-1", "transfer-1"))
	require.NoError(t, service.FailPanelWindowTransfer("workspace-1", "panel-1", "transfer-1"))
	require.NoError(t, service.FocusPanelWindow("workspace-1", "panel-1", "panel-a"))
	require.NoError(t, service.RequestPanelWindowClose("workspace-1", "panel-1", "owner-close"))
	require.NoError(t, service.AcknowledgePanelWindowClose("panel-1"))
	require.NoError(t, service.RequestClosePanelWindowsForCluster("workspace-1", "cluster-1"))
	require.NoError(t, service.AcknowledgeWorkspaceWindowClose("workspace-1"))
	require.NoError(t, service.RoutePanelWindowCommand("panel-1", "menu:settings"))
	require.NoError(t, service.RequestPanelObjectOpen("panel-1", ref, "details"))
	require.NoError(t, service.AuthorizePanelObjectOpen("workspace-1", "panel-1", "panel-a", ref, "details"))
	require.NoError(t, service.UpdatePanelWindowSnapshot("panel-1", snapshot))
	require.NoError(t, service.RequestPanelTabClose("panel-1", "panel-a"))
	require.NoError(t, service.AuthorizePanelTabClose("workspace-1", "panel-1", "panel-a"))
	require.NoError(t, service.RequestPanelWindowGuard("workspace-1", "panel-1", "guard-1", "quit"))
	require.NoError(t, service.AcknowledgePanelWindowGuard("panel-1", "guard-1", true))
	require.NoError(t, service.AcknowledgeApplicationQuitPreflight("workspace-1", "quit-1", true))
	require.Equal(t, 20, called)
}
