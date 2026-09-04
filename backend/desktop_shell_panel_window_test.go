package backend

import (
	"context"
	"fmt"
	"testing"

	"github.com/luxury-yacht/app/internal/panelwindow"
	"github.com/stretchr/testify/require"
	"github.com/wailsapp/wails/v3/pkg/application"
)

type panelCommandCaller string

func (caller panelCommandCaller) Name() string { return string(caller) }

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

func TestDesktopServiceUsesTheWailsSenderForRoleAwareMenuCommands(t *testing.T) {
	events := []string{}
	ownerRoutes := []struct {
		windowName string
		command    panelwindow.OwnerCommand
	}{}
	shell := NewDesktopShell(
		nil,
		func() bool { return true },
		func(name string, _ ...interface{}) { events = append(events, name) },
		NewLogger(10),
		DesktopShellBindings{
			NativeWindowDescriptor: func(name string) (panelwindow.NativeDescriptor, error) {
				switch name {
				case "workspace-1":
					return panelwindow.NativeDescriptor{
						SchemaVersion: panelwindow.NativeDescriptorSchemaVersion,
						Role:          panelwindow.NativeRoleWorkspace,
						Workspace:     &panelwindow.WorkspaceDescriptor{WindowName: name},
					}, nil
				case "panel-1":
					return panelwindow.NativeDescriptor{
						SchemaVersion: panelwindow.NativeDescriptorSchemaVersion,
						Role:          panelwindow.NativeRolePanel,
						Panel: &panelwindow.WindowDescriptor{
							WindowName:      name,
							OwnerWindowName: "workspace-1",
							State:           panelwindow.WindowStateLive,
						},
					}, nil
				default:
					return panelwindow.NativeDescriptor{}, fmt.Errorf("native window %q is not registered", name)
				}
			},
			RoutePanelCommand: func(windowName string, command panelwindow.OwnerCommand) error {
				ownerRoutes = append(ownerRoutes, struct {
					windowName string
					command    panelwindow.OwnerCommand
				}{windowName: windowName, command: command})
				return nil
			},
		},
	)
	service := NewDesktopService(DesktopServiceDependencies{DesktopShell: shell})
	quitCalls := 0
	shell.quitApplication = func() { quitCalls++ }

	workspaceContext := context.WithValue(
		context.Background(), application.WindowKey, panelCommandCaller("workspace-1"),
	)
	require.NoError(
		t,
		service.ExecuteApplicationMenuCommand(workspaceContext, ApplicationMenuCommandOpenCluster),
	)
	require.Equal(t, []string{"open-cluster"}, events)

	panelContext := context.WithValue(
		context.Background(), application.WindowKey, panelCommandCaller("panel-1"),
	)
	ownerCommands := []struct {
		command ApplicationMenuCommand
		event   string
	}{
		{ApplicationMenuCommandOpenCluster, "open-cluster"},
		{ApplicationMenuCommandSettings, "open-settings"},
		{ApplicationMenuCommandCommandPalette, "open-command-palette"},
		{ApplicationMenuCommandToggleSidebar, "toggle-sidebar"},
		{ApplicationMenuCommandToggleObjectDiff, "toggle-object-diff"},
		{ApplicationMenuCommandToggleAppLogs, "toggle-app-logs-panel"},
		{ApplicationMenuCommandToggleDiagnostics, "toggle-diagnostics"},
		{ApplicationMenuCommandAbout, "open-about"},
		{ApplicationMenuCommandToggleFocusDebug, "debug:toggle-focus-overlay"},
		{ApplicationMenuCommandTogglePanelDebug, "debug:toggle-panel-overlay"},
		{ApplicationMenuCommandToggleMapDebug, "debug:toggle-map-overlay"},
		{ApplicationMenuCommandToggleIconDebug, "debug:toggle-icon-overlay"},
		{ApplicationMenuCommandToggleErrorDebug, "debug:toggle-error-overlay"},
	}
	for _, test := range ownerCommands {
		require.NoError(t, service.ExecuteApplicationMenuCommand(panelContext, test.command))
	}
	wantOwnerRoutes := make([]struct {
		windowName string
		command    panelwindow.OwnerCommand
	}, 0, len(ownerCommands))
	for _, test := range ownerCommands {
		wantOwnerRoutes = append(wantOwnerRoutes, struct {
			windowName string
			command    panelwindow.OwnerCommand
		}{windowName: "panel-1", command: panelwindow.OwnerCommand(test.event)})
	}
	require.Equal(t, wantOwnerRoutes, ownerRoutes)
	require.NoError(
		t,
		service.ExecuteApplicationMenuCommand(panelContext, ApplicationMenuCommandClose),
	)
	require.Equal(t, []string{"open-cluster", "menu:close"}, events)
	require.NoError(
		t,
		service.ExecuteApplicationMenuCommand(panelContext, ApplicationMenuCommandQuit),
	)
	require.Equal(t, 1, quitCalls)
	require.Equal(t, wantOwnerRoutes, ownerRoutes)
}

func TestApplicationMenuAllowsPanelCommandsDuringDocking(t *testing.T) {
	events := []string{}
	shell := NewDesktopShell(
		nil,
		func() bool { return true },
		func(name string, _ ...interface{}) { events = append(events, name) },
		NewLogger(10),
		DesktopShellBindings{
			NativeWindowDescriptor: func(name string) (panelwindow.NativeDescriptor, error) {
				return panelwindow.NativeDescriptor{
					SchemaVersion: panelwindow.NativeDescriptorSchemaVersion,
					Role:          panelwindow.NativeRolePanel,
					Panel: &panelwindow.WindowDescriptor{
						WindowName:      name,
						OwnerWindowName: "workspace-1",
						State:           panelwindow.WindowStateDocking,
					},
				}, nil
			},
		},
	)
	service := NewDesktopService(DesktopServiceDependencies{DesktopShell: shell})
	panelContext := context.WithValue(
		context.Background(), application.WindowKey, panelCommandCaller("panel-1"),
	)

	require.NoError(t, service.ExecuteApplicationMenuCommand(panelContext, ApplicationMenuCommandClose))
	require.NoError(t, service.ExecuteApplicationMenuCommand(panelContext, ApplicationMenuCommandQuit))
	require.Equal(t, []string{"menu:close"}, events)
}

func TestDesktopServiceAllowsUntargetedApplicationMenuCommandsWithoutAWailsSender(t *testing.T) {
	events := []string{}
	shell := NewDesktopShell(
		nil,
		func() bool { return true },
		func(name string, _ ...interface{}) { events = append(events, name) },
		NewLogger(10),
	)
	service := NewDesktopService(DesktopServiceDependencies{DesktopShell: shell})

	err := service.ExecuteApplicationMenuCommand(
		context.Background(),
		ApplicationMenuCommandSettings,
	)

	require.NoError(t, err)
	require.Equal(t, []string{"open-settings"}, events)
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
		AcknowledgeWorkspaceClose: func(string) error { mark(); return nil },
		RoutePanelCommand:         func(string, panelwindow.OwnerCommand) error { mark(); return nil },
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
		RequestPanelTabTransfer:    func(string, panelwindow.TabTransferRequest) error { mark(); return nil },
		AcceptPanelTabTransfer:     func(string, string) error { mark(); return nil },
		FailPanelTabTransfer:       func(string, string) error { mark(); return nil },
		RequestPanelGuard:          func(string, string, string, string) error { mark(); return nil },
		AcknowledgePanelGuard:      func(string, string, bool) error { mark(); return nil },
		AcknowledgeApplicationQuit: func(string, string, bool) error { mark(); return nil },
	})
	service := NewDesktopService(DesktopServiceDependencies{PanelWindows: shell})
	ctx := context.Background()
	snapshot := panelwindow.GroupSnapshot{OwnerWindowName: "workspace-1"}
	ref := panelwindow.ObjectReference{ClusterID: "cluster-1"}

	gotNative, err := service.GetNativeWindowDescriptor(ctx, "workspace-1")
	require.NoError(t, err)
	require.Equal(t, native, gotNative)
	gotWindow, err := service.BeginPanelWindowOpen(ctx, "workspace-1", snapshot)
	require.NoError(t, err)
	require.Equal(t, window, gotWindow)
	gotWindow, err = service.AcknowledgePanelWindowReady(ctx, "panel-1", "transfer-1")
	require.NoError(t, err)
	require.Equal(t, window, gotWindow)
	require.NoError(t, service.BeginPanelWindowDock(ctx, "panel-1", "right", snapshot))
	require.NoError(t, service.AcknowledgePanelWindowDock(ctx, "workspace-1", "panel-1", "transfer-1"))
	require.NoError(t, service.FailPanelWindowTransfer(ctx, "workspace-1", "panel-1", "transfer-1"))
	require.NoError(t, service.FocusPanelWindow(ctx, "workspace-1", "panel-1", "panel-a"))
	require.NoError(t, service.RequestPanelWindowClose(ctx, "workspace-1", "panel-1", "owner-close"))
	require.NoError(t, service.AcknowledgePanelWindowClose(ctx, "panel-1"))
	require.NoError(t, service.AcknowledgeWorkspaceWindowClose(ctx, "workspace-1"))
	require.NoError(t, service.RequestPanelObjectOpen(ctx, "panel-1", ref, "details"))
	require.NoError(t, service.AuthorizePanelObjectOpen(ctx, "workspace-1", "panel-1", "panel-a", ref, "details"))
	require.NoError(t, service.UpdatePanelWindowSnapshot(ctx, "panel-1", snapshot))
	require.NoError(t, service.RequestPanelTabClose(ctx, "panel-1", "panel-a"))
	require.NoError(t, service.AuthorizePanelTabClose(ctx, "workspace-1", "panel-1", "panel-a"))
	require.NoError(t, service.RequestPanelTabTransfer(ctx, "workspace-1", panelwindow.TabTransferRequest{}))
	require.NoError(t, service.AcceptPanelTabTransfer(ctx, "workspace-1", "tab-transfer-1"))
	require.NoError(t, service.FailPanelTabTransfer(ctx, "panel-1", "tab-transfer-1"))
	require.NoError(t, service.RequestPanelWindowGuard(ctx, "workspace-1", "panel-1", "guard-1", "quit"))
	require.NoError(t, service.AcknowledgePanelWindowGuard(ctx, "panel-1", "guard-1", true))
	require.NoError(t, service.AcknowledgeApplicationQuitPreflight(ctx, "workspace-1", "quit-1", true))
	require.Equal(t, 21, called)
}

func TestDesktopServiceRejectsPanelCommandsWhoseClaimedCallerDoesNotMatchTheWailsSender(t *testing.T) {
	called := false
	shell := NewDesktopShell(nil, nil, nil, nil, DesktopShellBindings{
		RequestPanelClose: func(string, string, string) error {
			called = true
			return nil
		},
	})
	service := NewDesktopService(DesktopServiceDependencies{PanelWindows: shell})
	ctx := context.WithValue(context.Background(), application.WindowKey, panelCommandCaller("panel-1"))

	err := service.RequestPanelWindowClose(ctx, "workspace-1", "panel-1", "owner-close")

	require.ErrorContains(t, err, "does not match Wails sender")
	require.False(t, called)
}

func TestDesktopServiceRejectsPanelTabTransfersWhoseClaimedCallerDoesNotMatchTheWailsSender(t *testing.T) {
	called := false
	shell := NewDesktopShell(nil, nil, nil, nil, DesktopShellBindings{
		RequestPanelTabTransfer: func(string, panelwindow.TabTransferRequest) error {
			called = true
			return nil
		},
		AcceptPanelTabTransfer: func(string, string) error {
			called = true
			return nil
		},
		FailPanelTabTransfer: func(string, string) error {
			called = true
			return nil
		},
	})
	service := NewDesktopService(DesktopServiceDependencies{PanelWindows: shell})
	ctx := context.WithValue(context.Background(), application.WindowKey, panelCommandCaller("panel-1"))

	tests := []struct {
		name string
		run  func() error
	}{
		{
			name: "request",
			run: func() error {
				return service.RequestPanelTabTransfer(ctx, "workspace-1", panelwindow.TabTransferRequest{})
			},
		},
		{
			name: "accept",
			run:  func() error { return service.AcceptPanelTabTransfer(ctx, "workspace-1", "transfer-1") },
		},
		{
			name: "fail",
			run:  func() error { return service.FailPanelTabTransfer(ctx, "workspace-1", "transfer-1") },
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			called = false
			require.ErrorContains(t, test.run(), "does not match Wails sender")
			require.False(t, called)
		})
	}
}
