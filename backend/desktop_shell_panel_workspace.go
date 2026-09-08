package backend

import (
	"context"
	"fmt"
	"github.com/luxury-yacht/app/internal/panelwindow"
)

func (s *DesktopShell) OpenClusterWindow(windowName, clusterID string) error {
	if s.panelWorkspace == nil {
		return fmt.Errorf("panel workspace registry is not available")
	}
	return s.panelWorkspace.OpenClusterWindow(windowName, clusterID)
}

func (s *DesktopShell) AcknowledgePanelWorkspaceReady(windowName string) error {
	if s.panelWorkspace == nil {
		return fmt.Errorf("panel workspace registry is not available")
	}
	return s.panelWorkspace.AcknowledgePanelWorkspaceReady(windowName)
}

func (s *DesktopShell) GetPanelWorkspace(windowName, clusterID string) (panelwindow.WorkspaceSnapshot, error) {
	if s.panelWorkspace == nil {
		return panelwindow.WorkspaceSnapshot{}, fmt.Errorf("panel workspace registry is not available")
	}
	return s.panelWorkspace.GetPanelWorkspace(windowName, clusterID)
}

func (s *DesktopShell) OpenPanelWorkspaceObject(windowName string, tab panelwindow.TabSnapshot) (panelwindow.PanelOpenResult, error) {
	if s.panelWorkspace == nil {
		return panelwindow.PanelOpenResult{}, fmt.Errorf("panel workspace registry is not available")
	}
	return s.panelWorkspace.OpenPanelWorkspaceObject(windowName, tab)
}

func (s *DesktopShell) PublishDockedPanels(windowName string, groups []panelwindow.WorkspaceGroup) error {
	if s.panelWorkspace == nil {
		return fmt.Errorf("panel workspace registry is not available")
	}
	return s.panelWorkspace.PublishDockedPanels(windowName, groups)
}

func (s *DesktopShell) RequestClusterTabTransfer(windowName string, request panelwindow.ClusterTabTransferRequest) error {
	if s.panelWorkspace == nil {
		return fmt.Errorf("panel workspace registry is not available")
	}
	return s.panelWorkspace.RequestClusterTabTransfer(windowName, request)
}

func (s *DesktopShell) AcceptClusterTabTransfer(windowName, transferID string, snapshot panelwindow.ClusterViewSnapshot) error {
	if s.panelWorkspace == nil {
		return fmt.Errorf("panel workspace registry is not available")
	}
	return s.panelWorkspace.AcceptClusterTabTransfer(windowName, transferID, snapshot)
}

func (s *DesktopShell) AcknowledgeClusterTabTransfer(windowName, transferID string) error {
	if s.panelWorkspace == nil {
		return fmt.Errorf("panel workspace registry is not available")
	}
	return s.panelWorkspace.AcknowledgeClusterTabTransfer(windowName, transferID)
}

func (s *DesktopShell) FailClusterTabTransfer(windowName, transferID string) error {
	if s.panelWorkspace == nil {
		return fmt.Errorf("panel workspace registry is not available")
	}
	return s.panelWorkspace.FailClusterTabTransfer(windowName, transferID)
}

func (s *DesktopShell) CloseClusterView(ctx context.Context, windowName, clusterID string) (bool, error) {
	if s.panelWorkspace == nil {
		return false, fmt.Errorf("panel workspace registry is not available")
	}
	return s.panelWorkspace.CloseClusterView(ctx, windowName, clusterID)
}

func (s *DesktopShell) AcknowledgeClusterPanelClose(windowName, transactionID string, allowed bool) error {
	if s.panelWorkspace == nil {
		return fmt.Errorf("panel workspace registry is not available")
	}
	return s.panelWorkspace.AcknowledgeClusterPanelClose(windowName, transactionID, allowed)
}
