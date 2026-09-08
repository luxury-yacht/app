package appwindow

import (
	"fmt"

	"github.com/luxury-yacht/app/internal/panelwindow"
	"github.com/wailsapp/wails/v3/pkg/application"
)

type nativeWindowRegistry interface {
	panelwindow.SharedWorkspaceCommands
	PrepareApplicationQuit() bool
	FocusMostRecent()
	Create(bool) *application.WebviewWindow
	WindowDescriptor(string) (panelwindow.NativeDescriptor, error)
	BeginPanelWindowOpen(panelwindow.GroupSnapshot) (panelwindow.WindowDescriptor, error)
	AcknowledgePanelWindowReady(string, string) (panelwindow.WindowDescriptor, error)
	BeginPanelWindowDock(string, string, panelwindow.GroupSnapshot) error
	AcknowledgePanelWindowDock(string, string, string) error
	FailPanelWindowTransfer(string, string, string) error
	AcknowledgePanelWindowClose(string) error
	AcknowledgeWorkspaceWindowClose(string) error
	RoutePanelWindowCommand(string, panelwindow.WorkspaceCommand) error
	UpdatePanelWindowSnapshot(string, panelwindow.GroupSnapshot) error
	RequestPanelTabClose(string, string) error
	RequestPanelTabTransfer(string, panelwindow.TabTransferRequest) error
	AcceptPanelTabTransfer(string, string) error
	FailPanelTabTransfer(string, string) error
	AcknowledgeApplicationQuitPreflight(string, string, bool) error
}

// Bridge breaks the startup cycle between backend composition
// and the native-window registry. It is bound once after both sides exist.
type Bridge struct {
	registry nativeWindowRegistry
}

func (bridge *Bridge) Bind(registry nativeWindowRegistry) {
	bridge.registry = registry
}

func (bridge *Bridge) registryOrError() (nativeWindowRegistry, error) {
	if bridge.registry == nil {
		return nil, fmt.Errorf("native window registry is not available")
	}
	return bridge.registry, nil
}

func (bridge *Bridge) PrepareApplicationQuit() bool {
	if bridge.registry == nil {
		return true
	}
	return bridge.registry.PrepareApplicationQuit()
}

func (bridge *Bridge) OnSecondInstanceLaunch(application.SecondInstanceData) {
	if bridge.registry != nil {
		bridge.registry.FocusMostRecent()
	}
}

func (bridge *Bridge) CreateWorkspaceWindow() {
	if bridge.registry != nil {
		bridge.registry.Create(false)
	}
}

func (bridge *Bridge) IsWorkspaceWindow(windowName string) bool {
	if bridge.registry == nil {
		return false
	}
	descriptor, err := bridge.registry.WindowDescriptor(windowName)
	return err == nil && descriptor.Role == panelwindow.NativeRoleWorkspace
}

func (bridge *Bridge) NativeWindowDescriptor(
	windowName string,
) (panelwindow.NativeDescriptor, error) {
	registry, err := bridge.registryOrError()
	if err != nil {
		return panelwindow.NativeDescriptor{}, err
	}
	return registry.WindowDescriptor(windowName)
}

func (bridge *Bridge) BeginPanelWindowOpen(
	snapshot panelwindow.GroupSnapshot,
) (panelwindow.WindowDescriptor, error) {
	registry, err := bridge.registryOrError()
	if err != nil {
		return panelwindow.WindowDescriptor{}, err
	}
	return registry.BeginPanelWindowOpen(snapshot)
}

func (bridge *Bridge) AcknowledgePanelReady(
	windowName, transferID string,
) (panelwindow.WindowDescriptor, error) {
	registry, err := bridge.registryOrError()
	if err != nil {
		return panelwindow.WindowDescriptor{}, err
	}
	return registry.AcknowledgePanelWindowReady(windowName, transferID)
}

func (bridge *Bridge) BeginPanelWindowDock(
	windowName, targetPosition string,
	snapshot panelwindow.GroupSnapshot,
) error {
	registry, err := bridge.registryOrError()
	if err != nil {
		return err
	}
	return registry.BeginPanelWindowDock(windowName, targetPosition, snapshot)
}

func (bridge *Bridge) AcknowledgePanelDock(
	callerWindowName, windowName, transferID string,
) error {
	registry, err := bridge.registryOrError()
	if err != nil {
		return err
	}
	return registry.AcknowledgePanelWindowDock(callerWindowName, windowName, transferID)
}

func (bridge *Bridge) FailPanelTransfer(
	callerWindowName, windowName, transferID string,
) error {
	registry, err := bridge.registryOrError()
	if err != nil {
		return err
	}
	return registry.FailPanelWindowTransfer(callerWindowName, windowName, transferID)
}

func (bridge *Bridge) AcknowledgePanelClose(windowName string) error {
	registry, err := bridge.registryOrError()
	if err != nil {
		return err
	}
	return registry.AcknowledgePanelWindowClose(windowName)
}

func (bridge *Bridge) AcknowledgeWorkspaceClose(callerWindowName string) error {
	registry, err := bridge.registryOrError()
	if err != nil {
		return err
	}
	return registry.AcknowledgeWorkspaceWindowClose(callerWindowName)
}

func (bridge *Bridge) RoutePanelCommand(windowName string, command panelwindow.WorkspaceCommand) error {
	registry, err := bridge.registryOrError()
	if err != nil {
		return err
	}
	return registry.RoutePanelWindowCommand(windowName, command)
}

func (bridge *Bridge) UpdatePanelSnapshot(
	windowName string,
	snapshot panelwindow.GroupSnapshot,
) error {
	registry, err := bridge.registryOrError()
	if err != nil {
		return err
	}
	return registry.UpdatePanelWindowSnapshot(windowName, snapshot)
}

func (bridge *Bridge) RequestPanelTabClose(windowName, panelID string) error {
	registry, err := bridge.registryOrError()
	if err != nil {
		return err
	}
	return registry.RequestPanelTabClose(windowName, panelID)
}

func (bridge *Bridge) RequestPanelTabTransfer(
	callerWindowName string,
	request panelwindow.TabTransferRequest,
) error {
	registry, err := bridge.registryOrError()
	if err != nil {
		return err
	}
	return registry.RequestPanelTabTransfer(callerWindowName, request)
}

func (bridge *Bridge) AcceptPanelTabTransfer(
	callerWindowName, transferID string,
) error {
	registry, err := bridge.registryOrError()
	if err != nil {
		return err
	}
	return registry.AcceptPanelTabTransfer(callerWindowName, transferID)
}

func (bridge *Bridge) FailPanelTabTransfer(
	callerWindowName, transferID string,
) error {
	registry, err := bridge.registryOrError()
	if err != nil {
		return err
	}
	return registry.FailPanelTabTransfer(callerWindowName, transferID)
}

func (bridge *Bridge) AcknowledgeApplicationQuit(
	callerWindowName, transactionID string,
	allowed bool,
) error {
	registry, err := bridge.registryOrError()
	if err != nil {
		return err
	}
	return registry.AcknowledgeApplicationQuitPreflight(callerWindowName, transactionID, allowed)
}
