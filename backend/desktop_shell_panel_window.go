package backend

import (
	"fmt"

	"github.com/luxury-yacht/app/internal/panelwindow"
)

// Panel-window registry commands intentionally do not use the workspace
// runtime-ready gate. A child calls GetNativeWindowDescriptor during frontend
// bootstrap, before it can render and acknowledge readiness; sender identity
// and the registry transfer state are the authorization boundary for the
// remaining commands in this file.
func (s *DesktopShell) GetNativeWindowDescriptor(
	windowName string,
) (panelwindow.NativeDescriptor, error) {
	if s == nil || s.nativeWindowDescriptor == nil {
		return panelwindow.NativeDescriptor{}, fmt.Errorf("panel-window registry is not available")
	}
	return s.nativeWindowDescriptor(windowName)
}

func (s *DesktopShell) BeginPanelWindowOpen(
	windowName string,
	snapshot panelwindow.GroupSnapshot,
) (panelwindow.WindowDescriptor, error) {
	if s == nil || s.beginPanelWindowOpen == nil {
		return panelwindow.WindowDescriptor{}, fmt.Errorf("panel-window registry is not available")
	}
	if windowName != snapshot.SourceWindowName {
		return panelwindow.WindowDescriptor{}, fmt.Errorf(
			"panel source %q does not match source window %q",
			snapshot.SourceWindowName,
			windowName,
		)
	}
	return s.beginPanelWindowOpen(snapshot)
}

func (s *DesktopShell) AcknowledgePanelWindowReady(
	windowName, transferID string,
) (panelwindow.WindowDescriptor, error) {
	if s == nil || s.acknowledgePanelReady == nil {
		return panelwindow.WindowDescriptor{}, fmt.Errorf("panel-window registry is not available")
	}
	return s.acknowledgePanelReady(windowName, transferID)
}

func (s *DesktopShell) BeginPanelWindowDock(windowName, targetPosition string, snapshot panelwindow.GroupSnapshot) error {
	if s == nil || s.beginPanelWindowDock == nil {
		return fmt.Errorf("panel-window registry is not available")
	}
	return s.beginPanelWindowDock(windowName, targetPosition, snapshot)
}

func (s *DesktopShell) AcknowledgePanelWindowDock(callerWindowName, windowName, transferID string) error {
	if s == nil || s.acknowledgePanelDock == nil {
		return fmt.Errorf("panel-window registry is not available")
	}
	return s.acknowledgePanelDock(callerWindowName, windowName, transferID)
}

func (s *DesktopShell) FailPanelWindowTransfer(callerWindowName, windowName, transferID string) error {
	if s == nil || s.failPanelTransfer == nil {
		return fmt.Errorf("panel-window registry is not available")
	}
	return s.failPanelTransfer(callerWindowName, windowName, transferID)
}

func (s *DesktopShell) AcknowledgePanelWindowClose(windowName string) error {
	if s == nil || s.acknowledgePanelClose == nil {
		return fmt.Errorf("panel-window registry is not available")
	}
	return s.acknowledgePanelClose(windowName)
}

func (s *DesktopShell) AcknowledgeWorkspaceWindowClose(callerWindowName string) error {
	if s == nil || s.acknowledgeWorkspaceClose == nil {
		return fmt.Errorf("panel-window registry is not available")
	}
	return s.acknowledgeWorkspaceClose(callerWindowName)
}

func (s *DesktopShell) RoutePanelWindowCommand(windowName string, command panelwindow.WorkspaceCommand) error {
	if s == nil || s.routePanelCommand == nil {
		return fmt.Errorf("panel-window registry is not available")
	}
	return s.routePanelCommand(windowName, command)
}

func (s *DesktopShell) UpdatePanelWindowSnapshot(windowName string, snapshot panelwindow.GroupSnapshot) error {
	if s == nil || s.updatePanelSnapshot == nil {
		return fmt.Errorf("panel-window registry is not available")
	}
	return s.updatePanelSnapshot(windowName, snapshot)
}

func (s *DesktopShell) RequestPanelTabClose(windowName, panelID string) error {
	if s == nil || s.requestPanelTabClose == nil {
		return fmt.Errorf("panel-window registry is not available")
	}
	return s.requestPanelTabClose(windowName, panelID)
}

func (s *DesktopShell) RequestPanelTabTransfer(
	callerWindowName string,
	request panelwindow.TabTransferRequest,
) error {
	if s == nil || s.requestPanelTabTransfer == nil {
		return fmt.Errorf("panel-window registry is not available")
	}
	return s.requestPanelTabTransfer(callerWindowName, request)
}

func (s *DesktopShell) AcceptPanelTabTransfer(callerWindowName, transferID string) error {
	if s == nil || s.acceptPanelTabTransfer == nil {
		return fmt.Errorf("panel-window registry is not available")
	}
	return s.acceptPanelTabTransfer(callerWindowName, transferID)
}

func (s *DesktopShell) FailPanelTabTransfer(callerWindowName, transferID string) error {
	if s == nil || s.failPanelTabTransfer == nil {
		return fmt.Errorf("panel-window registry is not available")
	}
	return s.failPanelTabTransfer(callerWindowName, transferID)
}

func (s *DesktopShell) AcknowledgeApplicationQuitPreflight(
	callerWindowName, transactionID string,
	allowed bool,
) error {
	if s == nil || s.acknowledgeApplicationQuit == nil {
		return fmt.Errorf("panel-window registry is not available")
	}
	return s.acknowledgeApplicationQuit(callerWindowName, transactionID, allowed)
}
