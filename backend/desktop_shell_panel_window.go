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
	if windowName != snapshot.OwnerWindowName {
		return panelwindow.WindowDescriptor{}, fmt.Errorf(
			"panel owner %q does not match source window %q",
			snapshot.OwnerWindowName,
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

func (s *DesktopShell) AcknowledgePanelWindowDock(ownerWindowName, windowName, transferID string) error {
	if s == nil || s.acknowledgePanelDock == nil {
		return fmt.Errorf("panel-window registry is not available")
	}
	return s.acknowledgePanelDock(ownerWindowName, windowName, transferID)
}

func (s *DesktopShell) FailPanelWindowTransfer(callerWindowName, windowName, transferID string) error {
	if s == nil || s.failPanelTransfer == nil {
		return fmt.Errorf("panel-window registry is not available")
	}
	return s.failPanelTransfer(callerWindowName, windowName, transferID)
}

func (s *DesktopShell) FocusPanelWindow(ownerWindowName, windowName, panelID string) error {
	if s == nil || s.focusPanelWindow == nil {
		return fmt.Errorf("panel-window registry is not available")
	}
	return s.focusPanelWindow(ownerWindowName, windowName, panelID)
}

func (s *DesktopShell) RequestPanelWindowClose(callerWindowName, windowName, reason string) error {
	if s == nil || s.requestPanelClose == nil {
		return fmt.Errorf("panel-window registry is not available")
	}
	return s.requestPanelClose(callerWindowName, windowName, reason)
}

func (s *DesktopShell) AcknowledgePanelWindowClose(windowName string) error {
	if s == nil || s.acknowledgePanelClose == nil {
		return fmt.Errorf("panel-window registry is not available")
	}
	return s.acknowledgePanelClose(windowName)
}

func (s *DesktopShell) AcknowledgeWorkspaceWindowClose(ownerWindowName string) error {
	if s == nil || s.acknowledgeWorkspaceClose == nil {
		return fmt.Errorf("panel-window registry is not available")
	}
	return s.acknowledgeWorkspaceClose(ownerWindowName)
}

func (s *DesktopShell) RoutePanelWindowCommand(windowName, eventName string) error {
	if s == nil || s.routePanelCommand == nil {
		return fmt.Errorf("panel-window registry is not available")
	}
	return s.routePanelCommand(windowName, eventName)
}

func (s *DesktopShell) RequestPanelObjectOpen(windowName string, ref panelwindow.ObjectReference, activeView string) error {
	if s == nil || s.requestPanelObjectOpen == nil {
		return fmt.Errorf("panel-window registry is not available")
	}
	return s.requestPanelObjectOpen(windowName, ref, activeView)
}

func (s *DesktopShell) AuthorizePanelObjectOpen(ownerWindowName, windowName, panelID string, ref panelwindow.ObjectReference, activeView string) error {
	if s == nil || s.authorizePanelObjectOpen == nil {
		return fmt.Errorf("panel-window registry is not available")
	}
	return s.authorizePanelObjectOpen(ownerWindowName, windowName, panelID, ref, activeView)
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

func (s *DesktopShell) AuthorizePanelTabClose(ownerWindowName, windowName, panelID string) error {
	if s == nil || s.authorizePanelTabClose == nil {
		return fmt.Errorf("panel-window registry is not available")
	}
	return s.authorizePanelTabClose(ownerWindowName, windowName, panelID)
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

func (s *DesktopShell) AcceptPanelTabTransfer(ownerWindowName, transferID string) error {
	if s == nil || s.acceptPanelTabTransfer == nil {
		return fmt.Errorf("panel-window registry is not available")
	}
	return s.acceptPanelTabTransfer(ownerWindowName, transferID)
}

func (s *DesktopShell) FailPanelTabTransfer(callerWindowName, transferID string) error {
	if s == nil || s.failPanelTabTransfer == nil {
		return fmt.Errorf("panel-window registry is not available")
	}
	return s.failPanelTabTransfer(callerWindowName, transferID)
}

func (s *DesktopShell) RequestPanelWindowGuard(
	ownerWindowName, windowName, requestID, reason string,
) error {
	if s == nil || s.requestPanelGuard == nil {
		return fmt.Errorf("panel-window registry is not available")
	}
	return s.requestPanelGuard(ownerWindowName, windowName, requestID, reason)
}

func (s *DesktopShell) AcknowledgePanelWindowGuard(
	windowName, requestID string,
	allowed bool,
) error {
	if s == nil || s.acknowledgePanelGuard == nil {
		return fmt.Errorf("panel-window registry is not available")
	}
	return s.acknowledgePanelGuard(windowName, requestID, allowed)
}

func (s *DesktopShell) AcknowledgeApplicationQuitPreflight(
	ownerWindowName, transactionID string,
	allowed bool,
) error {
	if s == nil || s.acknowledgeApplicationQuit == nil {
		return fmt.Errorf("panel-window registry is not available")
	}
	return s.acknowledgeApplicationQuit(ownerWindowName, transactionID, allowed)
}
