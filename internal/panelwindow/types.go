package panelwindow

import (
	"fmt"
	"strings"
)

const GroupSchemaVersion = 1

type TabKind string

const TabKindObject TabKind = "object"

// ObjectReference is the complete object identity allowed across a native
// panel-window boundary. Group and namespace are present but may be empty for
// core API groups and cluster-scoped objects.
type ObjectReference struct {
	ClusterID string `json:"clusterId"`
	Group     string `json:"group"`
	Version   string `json:"version"`
	Kind      string `json:"kind"`
	Namespace string `json:"namespace"`
	Name      string `json:"name"`
}

func ValidateObjectReference(ref ObjectReference) error {
	if strings.TrimSpace(ref.ClusterID) == "" ||
		strings.TrimSpace(ref.Version) == "" ||
		strings.TrimSpace(ref.Kind) == "" ||
		strings.TrimSpace(ref.Name) == "" {
		return fmt.Errorf("incomplete object identity")
	}
	return nil
}

type TabSnapshot struct {
	Kind       TabKind         `json:"kind"`
	PanelID    string          `json:"panelId"`
	ObjectRef  ObjectReference `json:"objectRef"`
	ActiveView string          `json:"activeView"`
}

type WindowBounds struct {
	X      int `json:"x"`
	Y      int `json:"y"`
	Width  int `json:"width"`
	Height int `json:"height"`
}

type WindowPoint struct {
	X int `json:"x"`
	Y int `json:"y"`
}

type GroupSnapshot struct {
	SchemaVersion         int           `json:"schemaVersion"`
	TransferID            string        `json:"transferId"`
	OwnerWindowName       string        `json:"ownerWindowName"`
	ClusterID             string        `json:"clusterId"`
	GroupID               string        `json:"groupId"`
	Tabs                  []TabSnapshot `json:"tabs"`
	ActivePanelID         string        `json:"activePanelId"`
	InitialBounds         *WindowBounds `json:"initialBounds,omitempty"`
	InitialPositionAnchor *WindowPoint  `json:"initialPositionAnchor,omitempty"`
	UseInitialPosition    bool          `json:"useInitialPosition,omitempty"`
}

func validateGroupSnapshotHeader(snapshot GroupSnapshot) error {
	if snapshot.SchemaVersion != GroupSchemaVersion {
		return fmt.Errorf("unsupported panel group schema version %d", snapshot.SchemaVersion)
	}
	if strings.TrimSpace(snapshot.TransferID) == "" ||
		strings.TrimSpace(snapshot.OwnerWindowName) == "" ||
		strings.TrimSpace(snapshot.ClusterID) == "" ||
		strings.TrimSpace(snapshot.GroupID) == "" {
		return fmt.Errorf("panel group requires transfer, owner, cluster, and group identity")
	}
	if len(snapshot.Tabs) == 0 {
		return fmt.Errorf("panel group requires at least one tab")
	}
	if snapshot.InitialBounds != nil &&
		(snapshot.InitialBounds.Width <= 0 || snapshot.InitialBounds.Height <= 0) {
		return fmt.Errorf("panel initial bounds require positive width and height")
	}
	if snapshot.InitialPositionAnchor != nil &&
		(snapshot.InitialBounds == nil || !snapshot.UseInitialPosition) {
		return fmt.Errorf("panel initial position anchor requires transferred initial bounds")
	}
	return nil
}

func validateGroupTab(
	index int,
	tab TabSnapshot,
	clusterID string,
	panelIDs map[string]struct{},
) error {
	if tab.Kind != TabKindObject {
		return fmt.Errorf("panel tab %d has unsupported kind %q", index, tab.Kind)
	}
	if strings.TrimSpace(tab.PanelID) == "" || strings.TrimSpace(tab.ActiveView) == "" {
		return fmt.Errorf("panel tab %d requires panel identity and active view", index)
	}
	if _, exists := panelIDs[tab.PanelID]; exists {
		return fmt.Errorf("panel group contains duplicate panel id %q", tab.PanelID)
	}
	panelIDs[tab.PanelID] = struct{}{}
	if err := ValidateObjectReference(tab.ObjectRef); err != nil {
		return fmt.Errorf("panel tab %q has incomplete object identity", tab.PanelID)
	}
	if tab.ObjectRef.ClusterID != clusterID {
		return fmt.Errorf(
			"panel tab %q belongs to cluster %q, not group cluster %q",
			tab.PanelID,
			tab.ObjectRef.ClusterID,
			clusterID,
		)
	}
	return nil
}

func validateGroupTabs(snapshot GroupSnapshot) error {
	panelIDs := make(map[string]struct{}, len(snapshot.Tabs))
	activeFound := false
	for index, tab := range snapshot.Tabs {
		if err := validateGroupTab(index, tab, snapshot.ClusterID, panelIDs); err != nil {
			return err
		}
		if tab.PanelID == snapshot.ActivePanelID {
			activeFound = true
		}
	}
	if !activeFound {
		return fmt.Errorf("active panel %q is not present in the group", snapshot.ActivePanelID)
	}
	return nil
}

func ValidateGroupSnapshot(snapshot GroupSnapshot) error {
	if err := validateGroupSnapshotHeader(snapshot); err != nil {
		return err
	}
	return validateGroupTabs(snapshot)
}

type WindowState string

const (
	WindowStateMissing WindowState = "missing"
	WindowStateOpening WindowState = "opening"
	WindowStateLive    WindowState = "live"
	WindowStateDocking WindowState = "docking"
)

type WindowDescriptor struct {
	WindowName      string        `json:"windowName"`
	OwnerWindowName string        `json:"ownerWindowName"`
	ClusterID       string        `json:"clusterId"`
	GroupID         string        `json:"groupId"`
	State           WindowState   `json:"state"`
	Snapshot        GroupSnapshot `json:"snapshot"`
}

const NativeDescriptorSchemaVersion = 1

type NativeRole string

const (
	NativeRoleWorkspace NativeRole = "workspace"
	NativeRolePanel     NativeRole = "panel"
)

type WorkspaceDescriptor struct {
	WindowName string `json:"windowName"`
}

type NativeDescriptor struct {
	SchemaVersion int                  `json:"schemaVersion"`
	Role          NativeRole           `json:"role"`
	Workspace     *WorkspaceDescriptor `json:"workspace,omitempty"`
	Panel         *WindowDescriptor    `json:"panel,omitempty"`
}

const (
	WindowOpenedEventName                      = "panel-window:opened"
	WindowDockRequestedEventName               = "panel-window:dock-requested"
	WindowFocusRequestedEventName              = "panel-window:focus-requested"
	WindowCloseRequestedEventName              = "panel-window:close-requested"
	WindowClosedEventName                      = "panel-window:closed"
	OwnerCloseRequestedEventName               = "panel-window:owner-close-requested"
	ObjectOpenRequestedEventName               = "panel-window:object-open-requested"
	ObjectOpenAuthorizedEventName              = "panel-window:object-open-authorized"
	SnapshotUpdatedEventName                   = "panel-window:snapshot-updated"
	TabCloseRequestedEventName                 = "panel-window:tab-close-requested"
	TabCloseAuthorizedEventName                = "panel-window:tab-close-authorized"
	ApplicationQuitPreflightRequestedEventName = "panel-window:application-quit-preflight-requested"
	WindowGuardRequestedEventName              = "panel-window:guard-requested"
	WindowGuardResultEventName                 = "panel-window:guard-result"
)

type WindowOpenedEvent struct {
	WindowName string        `json:"windowName"`
	TransferID string        `json:"transferId"`
	ClusterID  string        `json:"clusterId"`
	GroupID    string        `json:"groupId"`
	Snapshot   GroupSnapshot `json:"snapshot"`
}

type WindowDockRequestedEvent struct {
	WindowName     string        `json:"windowName"`
	TransferID     string        `json:"transferId"`
	TargetPosition string        `json:"targetPosition"`
	Snapshot       GroupSnapshot `json:"snapshot"`
}

type WindowFocusRequestedEvent struct {
	PanelID string `json:"panelId"`
}

type WindowCloseRequestedEvent struct {
	WindowName string `json:"windowName"`
	Reason     string `json:"reason"`
}

type WindowClosedEvent struct {
	WindowName string `json:"windowName"`
	ClusterID  string `json:"clusterId"`
	GroupID    string `json:"groupId"`
}

type OwnerCloseRequestedEvent struct {
	OwnerWindowName string   `json:"ownerWindowName"`
	PanelWindows    []string `json:"panelWindows"`
}

type ObjectOpenRequestEvent struct {
	SourceWindowName string          `json:"sourceWindowName"`
	OwnerWindowName  string          `json:"ownerWindowName"`
	ClusterID        string          `json:"clusterId"`
	GroupID          string          `json:"groupId"`
	ObjectRef        ObjectReference `json:"objectRef"`
	ActiveView       string          `json:"activeView"`
}

type ObjectOpenAuthorizedEvent struct {
	PanelID    string          `json:"panelId"`
	ObjectRef  ObjectReference `json:"objectRef"`
	ActiveView string          `json:"activeView"`
}

type SnapshotUpdatedEvent struct {
	WindowName string        `json:"windowName"`
	Snapshot   GroupSnapshot `json:"snapshot"`
}

type TabCloseRequestedEvent struct {
	SourceWindowName string `json:"sourceWindowName"`
	OwnerWindowName  string `json:"ownerWindowName"`
	ClusterID        string `json:"clusterId"`
	GroupID          string `json:"groupId"`
	PanelID          string `json:"panelId"`
}

type TabCloseAuthorizedEvent struct {
	PanelID string `json:"panelId"`
}

type ApplicationQuitPreflightRequestedEvent struct {
	TransactionID   string   `json:"transactionId"`
	OwnerWindowName string   `json:"ownerWindowName"`
	PanelWindows    []string `json:"panelWindows"`
}

type WindowGuardRequestedEvent struct {
	RequestID  string `json:"requestId"`
	WindowName string `json:"windowName"`
	Reason     string `json:"reason"`
}

type WindowGuardResultEvent struct {
	RequestID  string `json:"requestId"`
	WindowName string `json:"windowName"`
	Allowed    bool   `json:"allowed"`
}
