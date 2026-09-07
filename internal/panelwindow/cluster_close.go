package panelwindow

import "context"

type ClusterPanelCloseCommands interface {
	CloseClusterView(context.Context, string, string) (bool, error)
	AcknowledgeClusterPanelClose(string, string, bool) error
}

type ClusterPanelCloseEvent struct {
	TransactionID string `json:"transactionId"`
	WindowName    string `json:"windowName"`
	ClusterID     string `json:"clusterId"`
}

const (
	ClusterPanelCloseRequestedEventName = "cluster-panel-close:requested"
	ClusterPanelCloseSettledEventName   = "cluster-panel-close:settled"
)
