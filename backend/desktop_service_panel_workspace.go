package backend

import (
	"context"
	"github.com/luxury-yacht/app/internal/panelwindow"
)

func (s *DesktopService) AcknowledgePanelWorkspaceReady(ctx context.Context, windowName string) error {
	if err := validatePanelCommandCaller(ctx, windowName); err != nil {
		return err
	}
	return s.panelWindows.AcknowledgePanelWorkspaceReady(windowName)
}

func (s *DesktopService) GetPanelWorkspace(ctx context.Context, windowName, clusterID string) (panelwindow.WorkspaceSnapshot, error) {
	if err := validatePanelCommandCaller(ctx, windowName); err != nil {
		return panelwindow.WorkspaceSnapshot{}, err
	}
	return s.panelWindows.GetPanelWorkspace(windowName, clusterID)
}

func (s *DesktopService) OpenPanelWorkspaceObject(ctx context.Context, windowName string, tab panelwindow.TabSnapshot) (panelwindow.PanelOpenResult, error) {
	if err := validatePanelCommandCaller(ctx, windowName); err != nil {
		return panelwindow.PanelOpenResult{}, err
	}
	return s.panelWindows.OpenPanelWorkspaceObject(windowName, tab)
}

func (s *DesktopService) PublishDockedPanels(ctx context.Context, windowName string, groups []panelwindow.WorkspaceGroup) error {
	if err := validatePanelCommandCaller(ctx, windowName); err != nil {
		return err
	}
	return s.panelWindows.PublishDockedPanels(windowName, groups)
}

func (s *DesktopService) RequestClusterTabTransfer(ctx context.Context, windowName string, request panelwindow.ClusterTabTransferRequest) error {
	if err := validatePanelCommandCaller(ctx, windowName); err != nil {
		return err
	}
	return s.panelWindows.RequestClusterTabTransfer(windowName, request)
}

func (s *DesktopService) AcceptClusterTabTransfer(ctx context.Context, windowName, transferID string, snapshot panelwindow.ClusterViewSnapshot) error {
	if err := validatePanelCommandCaller(ctx, windowName); err != nil {
		return err
	}
	return s.panelWindows.AcceptClusterTabTransfer(windowName, transferID, snapshot)
}

func (s *DesktopService) AcknowledgeClusterTabTransfer(ctx context.Context, windowName, transferID string) error {
	if err := validatePanelCommandCaller(ctx, windowName); err != nil {
		return err
	}
	return s.panelWindows.AcknowledgeClusterTabTransfer(windowName, transferID)
}

func (s *DesktopService) FailClusterTabTransfer(ctx context.Context, windowName, transferID string) error {
	if err := validatePanelCommandCaller(ctx, windowName); err != nil {
		return err
	}
	return s.panelWindows.FailClusterTabTransfer(windowName, transferID)
}

func (s *DesktopService) CloseClusterView(ctx context.Context, windowName, clusterID string) (bool, error) {
	if err := validatePanelCommandCaller(ctx, windowName); err != nil {
		return false, err
	}
	return s.panelWindows.CloseClusterView(ctx, windowName, clusterID)
}

func (s *DesktopService) AcknowledgeClusterPanelClose(ctx context.Context, windowName, transactionID string, allowed bool) error {
	if err := validatePanelCommandCaller(ctx, windowName); err != nil {
		return err
	}
	return s.panelWindows.AcknowledgeClusterPanelClose(windowName, transactionID, allowed)
}
