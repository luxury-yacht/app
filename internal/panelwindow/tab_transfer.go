package panelwindow

import (
	"fmt"
	"strings"
)

type TabTransferTarget string

const (
	TabTransferTargetWorkspace   TabTransferTarget = "workspace"
	TabTransferTargetPanelWindow TabTransferTarget = "panel-window"
	TabTransferTargetNewWindow   TabTransferTarget = "new-window"
)

type TabTransferRequest struct {
	TransferID       string            `json:"transferId"`
	SourceWindowName string            `json:"sourceWindowName"`
	TargetWindowName string            `json:"targetWindowName"`
	OwnerWindowName  string            `json:"ownerWindowName"`
	ClusterID        string            `json:"clusterId"`
	SourceGroupID    string            `json:"sourceGroupId"`
	TargetGroupID    string            `json:"targetGroupId"`
	TargetIndex      int               `json:"targetIndex"`
	TargetKind       TabTransferTarget `json:"targetKind"`
	CursorX          int               `json:"cursorX"`
	CursorY          int               `json:"cursorY"`
	Tab              TabSnapshot       `json:"tab"`
}

func ValidateTabTransferRequest(request TabTransferRequest) error {
	if strings.TrimSpace(request.TransferID) == "" ||
		strings.TrimSpace(request.SourceWindowName) == "" ||
		strings.TrimSpace(request.OwnerWindowName) == "" ||
		strings.TrimSpace(request.ClusterID) == "" ||
		strings.TrimSpace(request.SourceGroupID) == "" ||
		strings.TrimSpace(request.TargetGroupID) == "" {
		return fmt.Errorf("panel tab transfer requires transfer, source, owner, cluster, and group identity")
	}
	if request.TargetIndex < 0 {
		return fmt.Errorf("panel tab transfer target index cannot be negative")
	}
	if err := validateGroupTab(0, request.Tab, request.ClusterID, make(map[string]struct{}, 1)); err != nil {
		return err
	}
	switch request.TargetKind {
	case TabTransferTargetWorkspace:
		if request.TargetWindowName != request.OwnerWindowName ||
			(request.TargetGroupID != "right" && request.TargetGroupID != "bottom") {
			return fmt.Errorf("workspace panel tab transfer requires an owner dock target")
		}
	case TabTransferTargetPanelWindow:
		if strings.TrimSpace(request.TargetWindowName) == "" {
			return fmt.Errorf("native panel tab transfer requires a target window")
		}
	case TabTransferTargetNewWindow:
		if request.TargetWindowName != "" {
			return fmt.Errorf("new panel tab transfer cannot name an existing target window")
		}
	default:
		return fmt.Errorf("unsupported panel tab transfer target %q", request.TargetKind)
	}
	return nil
}

const (
	TabTransferRequestedEventName       = "panel-window:tab-transfer-requested"
	TabTransferInsertRequestedEventName = "panel-window:tab-transfer-insert-requested"
	TabTransferCommittedEventName       = "panel-window:tab-transfer-committed"
	TabTransferFailedEventName          = "panel-window:tab-transfer-failed"
)

type TabTransferRequestedEvent struct {
	Request TabTransferRequest `json:"request"`
}

type TabTransferInsertRequestedEvent struct {
	Request TabTransferRequest `json:"request"`
}

type TabTransferCommittedEvent struct {
	Request TabTransferRequest `json:"request"`
}

type TabTransferFailedEvent struct {
	Request TabTransferRequest `json:"request"`
	Reason  string             `json:"reason"`
}
