package panelwindow

import (
	"encoding/json"
	"fmt"
)

type ClusterTabTransferRequest struct {
	TransferID       string `json:"transferId"`
	SourceWindowName string `json:"sourceWindowName"`
	TargetWindowName string `json:"targetWindowName"`
	ClusterID        string `json:"clusterId"`
	TargetIndex      int    `json:"targetIndex"`
}

type ClusterViewSnapshot struct {
	SchemaVersion int              `json:"schemaVersion"`
	ViewState     string           `json:"viewState"`
	Groups        []WorkspaceGroup `json:"groups"`
}

type ClusterTabTransferEvent struct {
	Request           ClusterTabTransferRequest `json:"request"`
	Snapshot          ClusterViewSnapshot       `json:"snapshot"`
	TargetAlreadyOpen bool                      `json:"targetAlreadyOpen"`
}

type ClusterTabTransferCommands interface {
	RequestClusterTabTransfer(string, ClusterTabTransferRequest) error
	AcceptClusterTabTransfer(string, string, ClusterViewSnapshot) error
	AcknowledgeClusterTabTransfer(string, string) error
	FailClusterTabTransfer(string, string) error
}

type ClusterViewTransferLifecycle interface {
	StageClusterViewTransfer(string, string, string) (bool, error)
	CommitClusterViewTransfer(string, string, string, []WorkspaceGroup) error
	CancelClusterViewTransfer(string, string) error
}

const (
	ClusterTabTransferRequestedEventName = "cluster-tab-transfer:requested"
	ClusterTabTransferInsertEventName    = "cluster-tab-transfer:insert"
	ClusterTabTransferCommittedEventName = "cluster-tab-transfer:committed"
	ClusterTabTransferFailedEventName    = "cluster-tab-transfer:failed"
)

func ValidateClusterViewSnapshot(clusterID, source string, snapshot ClusterViewSnapshot) error {
	if snapshot.SchemaVersion != 1 || len(snapshot.ViewState) > 1024*1024 || !json.Valid([]byte(snapshot.ViewState)) {
		return fmt.Errorf("invalid cluster view snapshot")
	}
	for _, group := range snapshot.Groups {
		if group.ClusterID != clusterID {
			return fmt.Errorf("cluster view contains foreign panel group")
		}
	}
	return ValidateWorkspaceGroups(source, PanelLocationDocked, snapshot.Groups)
}
