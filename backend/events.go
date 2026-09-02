package backend

import (
	"github.com/luxury-yacht/app/internal/panelwindow"
	"github.com/wailsapp/wails/v3/pkg/application"
)

const (
	appLogsAddedEventName               = "app-logs:added"
	appUpdateEventName                  = "app-update"
	backendErrorEventName               = "backend-error"
	clusterAuthFailedEventName          = "cluster:auth:failed"
	clusterAuthProgressEventName        = "cluster:auth:progress"
	clusterAuthRecoveredEventName       = "cluster:auth:recovered"
	clusterAuthRecoveringEventName      = "cluster:auth:recovering"
	clusterHealthDegradedEventName      = "cluster:health:degraded"
	clusterHealthHealthyEventName       = "cluster:health:healthy"
	clusterLifecycleEventName           = "cluster:lifecycle"
	clusterScopeChangedEventName        = "cluster:scope:changed"
	kubeconfigAvailableChangedEventName = "kubeconfig:available-changed"
	appearanceModeChangedEventName      = "settings:appearance-mode-changed"
	preferencesChangedEventName         = "settings:preferences-changed"
)

type AppearanceModeChangedEvent struct {
	Mode string `json:"mode"`
}

type ClusterAuthEvent struct {
	ClusterID   string `json:"clusterId"`
	ClusterName string `json:"clusterName"`
	Reason      string `json:"reason"`
	Class       string `json:"class"`
	Kind        string `json:"kind"`
	Summary     string `json:"summary"`
	ExecCommand string `json:"execCommand"`
}

type ClusterAuthProgressEvent struct {
	ClusterID         string `json:"clusterId"`
	ClusterName       string `json:"clusterName"`
	Reason            string `json:"reason"`
	Class             string `json:"class"`
	Kind              string `json:"kind"`
	Summary           string `json:"summary"`
	ExecCommand       string `json:"execCommand"`
	SecondsUntilRetry int    `json:"secondsUntilRetry"`
	ErrorClass        string `json:"errorClass"`
}

type ClusterHealthEvent struct {
	ClusterID   string `json:"clusterId"`
	ClusterName string `json:"clusterName"`
	Reason      string `json:"reason,omitempty"`
}

type ClusterLifecycleEvent struct {
	ClusterID     string                `json:"clusterId"`
	State         ClusterLifecycleState `json:"state"`
	PreviousState string                `json:"previousState"`
}

type ClusterScopeChangedEvent struct {
	ClusterID string `json:"clusterId"`
}

type BackendErrorEvent struct {
	ClusterID    string `json:"clusterId"`
	ResourceKind string `json:"resourceKind,omitempty"`
	Identifier   string `json:"identifier,omitempty"`
	Message      string `json:"message"`
	Error        string `json:"error,omitempty"`
	Source       string `json:"source,omitempty"`
}

func init() {
	application.RegisterEvent[AppLogsAddedEvent](appLogsAddedEventName)
	application.RegisterEvent[*UpdateInfo](appUpdateEventName)
	application.RegisterEvent[BackendErrorEvent](backendErrorEventName)
	application.RegisterEvent[ClusterAuthEvent](clusterAuthFailedEventName)
	application.RegisterEvent[ClusterAuthProgressEvent](clusterAuthProgressEventName)
	application.RegisterEvent[ClusterAuthEvent](clusterAuthRecoveredEventName)
	application.RegisterEvent[ClusterAuthEvent](clusterAuthRecoveringEventName)
	application.RegisterEvent[ClusterHealthEvent](clusterHealthDegradedEventName)
	application.RegisterEvent[ClusterHealthEvent](clusterHealthHealthyEventName)
	application.RegisterEvent[ClusterLifecycleEvent](clusterLifecycleEventName)
	application.RegisterEvent[ClusterScopeChangedEvent](clusterScopeChangedEventName)
	application.RegisterEvent[application.Void](kubeconfigAvailableChangedEventName)
	application.RegisterEvent[AppearanceModeChangedEvent](appearanceModeChangedEventName)
	application.RegisterEvent[application.Void](preferencesChangedEventName)

	application.RegisterEvent[application.Void]("debug:open-inspector")
	application.RegisterEvent[application.Void]("debug:toggle-error-overlay")
	application.RegisterEvent[application.Void]("debug:toggle-focus-overlay")
	application.RegisterEvent[application.Void]("debug:toggle-icon-overlay")
	application.RegisterEvent[application.Void]("debug:toggle-map-overlay")
	application.RegisterEvent[application.Void]("debug:toggle-panel-overlay")
	application.RegisterEvent[application.Void]("menu:close")
	application.RegisterEvent[application.Void]("menu:copy")
	application.RegisterEvent[application.Void]("menu:cut")
	application.RegisterEvent[string]("menu:paste")
	application.RegisterEvent[application.Void]("menu:selectAll")
	application.RegisterEvent[application.Void]("open-about")
	application.RegisterEvent[application.Void]("open-cluster")
	application.RegisterEvent[application.Void]("open-command-palette")
	application.RegisterEvent[application.Void]("open-settings")
	application.RegisterEvent[application.Void]("toggle-app-logs-panel")
	application.RegisterEvent[application.Void]("toggle-diagnostics")
	application.RegisterEvent[application.Void]("toggle-object-diff")
	application.RegisterEvent[application.Void]("toggle-sidebar")
	application.RegisterEvent[application.Void]("zoom-in")
	application.RegisterEvent[application.Void]("zoom-out")
	application.RegisterEvent[application.Void]("zoom-reset")
	application.RegisterEvent[panelwindow.WindowOpenedEvent](panelwindow.WindowOpenedEventName)
	application.RegisterEvent[panelwindow.WindowDockRequestedEvent](panelwindow.WindowDockRequestedEventName)
	application.RegisterEvent[panelwindow.WindowFocusRequestedEvent](panelwindow.WindowFocusRequestedEventName)
	application.RegisterEvent[panelwindow.WindowCloseRequestedEvent](panelwindow.WindowCloseRequestedEventName)
	application.RegisterEvent[panelwindow.WindowClosedEvent](panelwindow.WindowClosedEventName)
	application.RegisterEvent[panelwindow.OwnerCloseRequestedEvent](panelwindow.OwnerCloseRequestedEventName)
	application.RegisterEvent[panelwindow.ObjectOpenRequestEvent](panelwindow.ObjectOpenRequestedEventName)
	application.RegisterEvent[panelwindow.ObjectOpenAuthorizedEvent](panelwindow.ObjectOpenAuthorizedEventName)
	application.RegisterEvent[panelwindow.SnapshotUpdatedEvent](panelwindow.SnapshotUpdatedEventName)
	application.RegisterEvent[panelwindow.TabCloseRequestedEvent](panelwindow.TabCloseRequestedEventName)
	application.RegisterEvent[panelwindow.TabCloseAuthorizedEvent](panelwindow.TabCloseAuthorizedEventName)
	application.RegisterEvent[panelwindow.TabTransferRequestedEvent](panelwindow.TabTransferRequestedEventName)
	application.RegisterEvent[panelwindow.TabTransferInsertRequestedEvent](panelwindow.TabTransferInsertRequestedEventName)
	application.RegisterEvent[panelwindow.TabTransferCommittedEvent](panelwindow.TabTransferCommittedEventName)
	application.RegisterEvent[panelwindow.TabTransferFailedEvent](panelwindow.TabTransferFailedEventName)
	application.RegisterEvent[panelwindow.ApplicationQuitPreflightRequestedEvent](panelwindow.ApplicationQuitPreflightRequestedEventName)
	application.RegisterEvent[panelwindow.WindowGuardRequestedEvent](panelwindow.WindowGuardRequestedEventName)
	application.RegisterEvent[panelwindow.WindowGuardResultEvent](panelwindow.WindowGuardResultEventName)

	application.RegisterEvent[[]ShellSessionInfo](shellListEventName)
	application.RegisterEvent[ShellOutputEvent](shellOutputEventName)
	application.RegisterEvent[ShellStatusEvent](shellStatusEventName)
	application.RegisterEvent[[]PortForwardSession](portForwardListEventName)
	application.RegisterEvent[PortForwardStatusEvent](portForwardStatusEventName)
	application.RegisterEvent[[]RuntimeOperation](runtimeOperationsListEventName)
}
