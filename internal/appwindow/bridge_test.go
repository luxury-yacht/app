package appwindow

import (
	"testing"

	"github.com/luxury-yacht/app/internal/panelwindow"
	"github.com/stretchr/testify/require"
	"github.com/wailsapp/wails/v3/pkg/application"
)

type recordingNativeWindowRegistry struct {
	panelwindow.SharedWorkspaceCommands
	calls []string
}

func (registry *recordingNativeWindowRegistry) record(call string) {
	registry.calls = append(registry.calls, call)
}

func (registry *recordingNativeWindowRegistry) PrepareApplicationQuit() bool {
	registry.record("prepare-quit")
	return false
}

func (registry *recordingNativeWindowRegistry) FocusMostRecent() {
	registry.record("focus-most-recent")
}

func (registry *recordingNativeWindowRegistry) Create(bool) *application.WebviewWindow {
	registry.record("create-workspace")
	return nil
}

func (registry *recordingNativeWindowRegistry) WindowDescriptor(
	string,
) (panelwindow.NativeDescriptor, error) {
	registry.record("window-descriptor")
	return panelwindow.NativeDescriptor{Role: panelwindow.NativeRoleWorkspace}, nil
}

func (registry *recordingNativeWindowRegistry) BeginPanelWindowOpen(
	panelwindow.GroupSnapshot,
) (panelwindow.WindowDescriptor, error) {
	registry.record("begin-open")
	return panelwindow.WindowDescriptor{}, nil
}

func (registry *recordingNativeWindowRegistry) AcknowledgePanelWindowReady(
	string,
	string,
) (panelwindow.WindowDescriptor, error) {
	registry.record("acknowledge-ready")
	return panelwindow.WindowDescriptor{}, nil
}

func (registry *recordingNativeWindowRegistry) BeginPanelWindowDock(
	string,
	string,
	panelwindow.GroupSnapshot,
) error {
	registry.record("begin-dock")
	return nil
}

func (registry *recordingNativeWindowRegistry) AcknowledgePanelWindowDock(string, string, string) error {
	registry.record("acknowledge-dock")
	return nil
}

func (registry *recordingNativeWindowRegistry) FailPanelWindowTransfer(string, string, string) error {
	registry.record("fail-transfer")
	return nil
}

func (registry *recordingNativeWindowRegistry) AcknowledgePanelWindowClose(string) error {
	registry.record("acknowledge-close")
	return nil
}

func (registry *recordingNativeWindowRegistry) AcknowledgeWorkspaceWindowClose(string) error {
	registry.record("acknowledge-workspace-close")
	return nil
}

func (registry *recordingNativeWindowRegistry) RoutePanelWindowCommand(string, panelwindow.WorkspaceCommand) error {
	registry.record("route-command")
	return nil
}

func (registry *recordingNativeWindowRegistry) UpdatePanelWindowSnapshot(
	string,
	panelwindow.GroupSnapshot,
) error {
	registry.record("update-snapshot")
	return nil
}

func (registry *recordingNativeWindowRegistry) RequestPanelTabClose(string, string) error {
	registry.record("request-tab-close")
	return nil
}

func (registry *recordingNativeWindowRegistry) RequestPanelTabTransfer(
	string,
	panelwindow.TabTransferRequest,
) error {
	registry.record("request-tab-transfer")
	return nil
}

func (registry *recordingNativeWindowRegistry) AcceptPanelTabTransfer(string, string) error {
	registry.record("accept-tab-transfer")
	return nil
}

func (registry *recordingNativeWindowRegistry) FailPanelTabTransfer(string, string) error {
	registry.record("fail-tab-transfer")
	return nil
}

func (registry *recordingNativeWindowRegistry) AcknowledgeApplicationQuitPreflight(
	string,
	string,
	bool,
) error {
	registry.record("acknowledge-quit")
	return nil
}

func TestWindowRegistryBridgePreservesUnboundStartupSemantics(t *testing.T) {
	bridge := &Bridge{}
	options := bridge

	require.True(t, bridge.PrepareApplicationQuit())
	require.False(t, options.IsWorkspaceWindow("workspace-1"))
	require.NotPanics(t, options.CreateWorkspaceWindow)
	_, err := options.NativeWindowDescriptor("workspace-1")
	require.ErrorContains(t, err, "native window registry is not available")
	_, err = options.BeginPanelWindowOpen(panelwindow.GroupSnapshot{})
	require.ErrorContains(t, err, "native window registry is not available")
	_, err = options.AcknowledgePanelReady("panel-1", "transfer-1")
	require.ErrorContains(t, err, "native window registry is not available")
	err = options.BeginPanelWindowDock("panel-1", "right", panelwindow.GroupSnapshot{})
	require.ErrorContains(t, err, "native window registry is not available")
	err = options.AcknowledgePanelDock("workspace-1", "panel-1", "transfer-1")
	require.ErrorContains(t, err, "native window registry is not available")
	err = options.FailPanelTransfer("workspace-1", "panel-1", "transfer-1")
	require.ErrorContains(t, err, "native window registry is not available")
	err = options.AcknowledgePanelClose("panel-1")
	require.ErrorContains(t, err, "native window registry is not available")
	err = options.AcknowledgeWorkspaceClose("workspace-1")
	require.ErrorContains(t, err, "native window registry is not available")
	err = options.RoutePanelCommand("panel-1", "command")
	require.ErrorContains(t, err, "native window registry is not available")
	err = options.UpdatePanelSnapshot("panel-1", panelwindow.GroupSnapshot{})
	require.ErrorContains(t, err, "native window registry is not available")
	err = options.RequestPanelTabClose("panel-1", "tab-1")
	require.ErrorContains(t, err, "native window registry is not available")
	err = options.RequestPanelTabTransfer("panel-1", panelwindow.TabTransferRequest{})
	require.ErrorContains(t, err, "native window registry is not available")
	err = options.AcceptPanelTabTransfer("workspace-1", "tab-transfer-1")
	require.ErrorContains(t, err, "native window registry is not available")
	err = options.FailPanelTabTransfer("panel-1", "tab-transfer-1")
	require.ErrorContains(t, err, "native window registry is not available")
	err = options.AcknowledgeApplicationQuit("workspace-1", "quit-1", true)
	require.ErrorContains(t, err, "native window registry is not available")
}

func TestWindowRegistryBridgeForwardsEveryRuntimeOperationAfterBinding(t *testing.T) {
	registry := &recordingNativeWindowRegistry{}
	bridge := &Bridge{}
	bridge.Bind(registry)
	options := bridge
	snapshot := panelwindow.GroupSnapshot{}

	require.False(t, bridge.PrepareApplicationQuit())
	bridge.OnSecondInstanceLaunch(application.SecondInstanceData{})
	options.CreateWorkspaceWindow()
	require.True(t, options.IsWorkspaceWindow("workspace-1"))
	_, err := options.NativeWindowDescriptor("workspace-1")
	require.NoError(t, err)
	_, err = options.BeginPanelWindowOpen(snapshot)
	require.NoError(t, err)
	_, err = options.AcknowledgePanelReady("panel-1", "transfer-1")
	require.NoError(t, err)
	require.NoError(t, options.BeginPanelWindowDock("panel-1", "right", snapshot))
	require.NoError(t, options.AcknowledgePanelDock("workspace-1", "panel-1", "transfer-1"))
	require.NoError(t, options.FailPanelTransfer("workspace-1", "panel-1", "transfer-1"))
	require.NoError(t, options.AcknowledgePanelClose("panel-1"))
	require.NoError(t, options.AcknowledgeWorkspaceClose("workspace-1"))
	require.NoError(t, options.RoutePanelCommand("panel-1", "command"))
	require.NoError(t, options.UpdatePanelSnapshot("panel-1", snapshot))
	require.NoError(t, options.RequestPanelTabClose("panel-1", "tab-1"))
	require.NoError(t, options.RequestPanelTabTransfer("panel-1", panelwindow.TabTransferRequest{}))
	require.NoError(t, options.AcceptPanelTabTransfer("workspace-1", "tab-transfer-1"))
	require.NoError(t, options.FailPanelTabTransfer("panel-1", "tab-transfer-1"))
	require.NoError(t, options.AcknowledgeApplicationQuit("workspace-1", "quit-1", true))

	require.Equal(t, []string{
		"prepare-quit",
		"focus-most-recent",
		"create-workspace",
		"window-descriptor",
		"window-descriptor",
		"begin-open",
		"acknowledge-ready",
		"begin-dock",
		"acknowledge-dock",
		"fail-transfer",
		"acknowledge-close",
		"acknowledge-workspace-close",
		"route-command",
		"update-snapshot",
		"request-tab-close",
		"request-tab-transfer",
		"accept-tab-transfer",
		"fail-tab-transfer",
		"acknowledge-quit",
	}, registry.calls)
}
