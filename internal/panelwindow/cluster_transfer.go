package panelwindow

import (
	"encoding/json"
	"fmt"
)

type ClusterTabTransferRequest struct {
	TransferID       string       `json:"transferId"`
	SourceWindowName string       `json:"sourceWindowName"`
	TargetWindowName string       `json:"targetWindowName"`
	ClusterID        string       `json:"clusterId"`
	TargetIndex      int          `json:"targetIndex"`
	DropPosition     *WindowPoint `json:"dropPosition,omitempty"`
}

// ClusterViewSnapshot is the source view's navigation state. Its docked panels
// are not part of it: the directory moves the panels it places in that view.
type ClusterViewSnapshot struct {
	SchemaVersion int    `json:"schemaVersion"`
	ViewState     string `json:"viewState"`
}

type ClusterTabTransferEvent struct {
	Request  ClusterTabTransferRequest `json:"request"`
	Snapshot ClusterViewSnapshot       `json:"snapshot"`
	// Groups are the panels the directory is moving with the view, which the
	// target reconstructs before it acknowledges.
	Groups            []WorkspaceGroup `json:"groups"`
	TargetAlreadyOpen bool             `json:"targetAlreadyOpen"`
}

type ClusterTabTransferCommands interface {
	RequestClusterTabTransfer(string, ClusterTabTransferRequest) error
	AcceptClusterTabTransfer(string, string, ClusterViewSnapshot) error
	AcknowledgeClusterTabTransfer(string, string) error
	FailClusterTabTransfer(string, string) error
}

type ClusterViewTransferLifecycle interface {
	StageClusterViewTransfer(string, string, string) (bool, error)
	CommitClusterViewTransfer(string, string, string, string) error
	CancelClusterViewTransfer(string, string) error
}

const (
	ClusterTabTransferRequestedEventName = "cluster-tab-transfer:requested"
	ClusterTabTransferInsertEventName    = "cluster-tab-transfer:insert"
	ClusterTabTransferCommittedEventName = "cluster-tab-transfer:committed"
	ClusterTabTransferFailedEventName    = "cluster-tab-transfer:failed"
)

func ValidateClusterViewSnapshot(snapshot ClusterViewSnapshot) error {
	if snapshot.SchemaVersion != 1 || len(snapshot.ViewState) > 1024*1024 || !json.Valid([]byte(snapshot.ViewState)) {
		return fmt.Errorf("invalid cluster view snapshot")
	}
	return nil
}
