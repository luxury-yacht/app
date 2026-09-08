package appwindow

import (
	"context"

	"github.com/luxury-yacht/app/internal/panelwindow"
)

func (bridge *Bridge) OpenClusterWindow(windowName, clusterID string) error {
	registry, err := bridge.registryOrError()
	if err != nil {
		return err
	}
	return registry.OpenClusterWindow(windowName, clusterID)
}

func (bridge *Bridge) AcknowledgePanelWorkspaceReady(windowName string) error {
	registry, err := bridge.registryOrError()
	if err != nil {
		return err
	}
	return registry.AcknowledgePanelWorkspaceReady(windowName)
}

func (bridge *Bridge) GetPanelWorkspace(windowName, clusterID string) (panelwindow.WorkspaceSnapshot, error) {
	registry, err := bridge.registryOrError()
	if err != nil {
		return panelwindow.WorkspaceSnapshot{}, err
	}
	return registry.GetPanelWorkspace(windowName, clusterID)
}

func (bridge *Bridge) OpenPanelWorkspaceObject(windowName string, tab panelwindow.TabSnapshot) (panelwindow.PanelOpenResult, error) {
	registry, err := bridge.registryOrError()
	if err != nil {
		return panelwindow.PanelOpenResult{}, err
	}
	return registry.OpenPanelWorkspaceObject(windowName, tab)
}

func (bridge *Bridge) PublishDockedPanels(windowName string, groups []panelwindow.WorkspaceGroup) error {
	registry, err := bridge.registryOrError()
	if err != nil {
		return err
	}
	return registry.PublishDockedPanels(windowName, groups)
}

func (bridge *Bridge) RequestClusterTabTransfer(windowName string, request panelwindow.ClusterTabTransferRequest) error {
	registry, err := bridge.registryOrError()
	if err != nil {
		return err
	}
	return registry.RequestClusterTabTransfer(windowName, request)
}

func (bridge *Bridge) AcceptClusterTabTransfer(windowName, transferID string, snapshot panelwindow.ClusterViewSnapshot) error {
	registry, err := bridge.registryOrError()
	if err != nil {
		return err
	}
	return registry.AcceptClusterTabTransfer(windowName, transferID, snapshot)
}

func (bridge *Bridge) AcknowledgeClusterTabTransfer(windowName, transferID string) error {
	registry, err := bridge.registryOrError()
	if err != nil {
		return err
	}
	return registry.AcknowledgeClusterTabTransfer(windowName, transferID)
}

func (bridge *Bridge) FailClusterTabTransfer(windowName, transferID string) error {
	registry, err := bridge.registryOrError()
	if err != nil {
		return err
	}
	return registry.FailClusterTabTransfer(windowName, transferID)
}

func (bridge *Bridge) CloseClusterView(ctx context.Context, windowName, clusterID string) (bool, error) {
	registry, err := bridge.registryOrError()
	if err != nil {
		return false, err
	}
	return registry.CloseClusterView(ctx, windowName, clusterID)
}

func (bridge *Bridge) AcknowledgeClusterPanelClose(windowName, transactionID string, allowed bool) error {
	registry, err := bridge.registryOrError()
	if err != nil {
		return err
	}
	return registry.AcknowledgeClusterPanelClose(windowName, transactionID, allowed)
}
