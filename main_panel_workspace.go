package main

import (
	"context"
	"github.com/luxury-yacht/app/internal/panelwindow"
)

func (bridge *windowRegistryBridge) OpenClusterWindow(windowName, clusterID string) error {
	registry, err := bridge.registryOrError()
	if err != nil {
		return err
	}
	return registry.OpenClusterWindow(windowName, clusterID)
}

func (bridge *windowRegistryBridge) AcknowledgePanelWorkspaceReady(windowName string) error {
	registry, err := bridge.registryOrError()
	if err != nil {
		return err
	}
	return registry.AcknowledgePanelWorkspaceReady(windowName)
}

func (bridge *windowRegistryBridge) GetPanelWorkspace(windowName, clusterID string) (panelwindow.WorkspaceSnapshot, error) {
	registry, err := bridge.registryOrError()
	if err != nil {
		return panelwindow.WorkspaceSnapshot{}, err
	}
	return registry.GetPanelWorkspace(windowName, clusterID)
}

func (bridge *windowRegistryBridge) OpenPanelWorkspaceObject(windowName string, tab panelwindow.TabSnapshot) (panelwindow.PanelOpenResult, error) {
	registry, err := bridge.registryOrError()
	if err != nil {
		return panelwindow.PanelOpenResult{}, err
	}
	return registry.OpenPanelWorkspaceObject(windowName, tab)
}

func (bridge *windowRegistryBridge) PublishDockedPanels(windowName string, groups []panelwindow.WorkspaceGroup) error {
	registry, err := bridge.registryOrError()
	if err != nil {
		return err
	}
	return registry.PublishDockedPanels(windowName, groups)
}

func (bridge *windowRegistryBridge) RequestClusterTabTransfer(windowName string, request panelwindow.ClusterTabTransferRequest) error {
	registry, err := bridge.registryOrError()
	if err != nil {
		return err
	}
	return registry.RequestClusterTabTransfer(windowName, request)
}

func (bridge *windowRegistryBridge) AcceptClusterTabTransfer(windowName, transferID string, snapshot panelwindow.ClusterViewSnapshot) error {
	registry, err := bridge.registryOrError()
	if err != nil {
		return err
	}
	return registry.AcceptClusterTabTransfer(windowName, transferID, snapshot)
}

func (bridge *windowRegistryBridge) AcknowledgeClusterTabTransfer(windowName, transferID string) error {
	registry, err := bridge.registryOrError()
	if err != nil {
		return err
	}
	return registry.AcknowledgeClusterTabTransfer(windowName, transferID)
}

func (bridge *windowRegistryBridge) FailClusterTabTransfer(windowName, transferID string) error {
	registry, err := bridge.registryOrError()
	if err != nil {
		return err
	}
	return registry.FailClusterTabTransfer(windowName, transferID)
}

func (bridge *windowRegistryBridge) CloseClusterView(ctx context.Context, windowName, clusterID string) (bool, error) {
	registry, err := bridge.registryOrError()
	if err != nil {
		return false, err
	}
	return registry.CloseClusterView(ctx, windowName, clusterID)
}

func (bridge *windowRegistryBridge) AcknowledgeClusterPanelClose(windowName, transactionID string, allowed bool) error {
	registry, err := bridge.registryOrError()
	if err != nil {
		return err
	}
	return registry.AcknowledgeClusterPanelClose(windowName, transactionID, allowed)
}
