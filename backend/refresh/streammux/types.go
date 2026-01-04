package streammux

import "github.com/luxury-yacht/app/backend/refresh"

// MessageType represents the message type used for stream requests and updates.
type MessageType string

const (
	MessageTypeRequest   MessageType = "REQUEST"
	MessageTypeCancel    MessageType = "CANCEL"
	MessageTypeAck       MessageType = "ACK"
	MessageTypeError     MessageType = "ERROR"
	MessageTypeHeartbeat MessageType = "HEARTBEAT"
	MessageTypeReset     MessageType = "RESET"
	MessageTypeComplete  MessageType = "COMPLETE"
	MessageTypeAdded     MessageType = "ADDED"
	MessageTypeModified  MessageType = "MODIFIED"
	MessageTypeDeleted   MessageType = "DELETED"
)

// DropReason captures why a subscription was terminated.
type DropReason string

const (
	DropReasonBackpressure DropReason = "backpressure"
	DropReasonClosed       DropReason = "closed"
)

// ClientMessage is the request envelope sent from websocket clients.
type ClientMessage struct {
	Type            MessageType `json:"type"`
	ClusterID       string      `json:"clusterId,omitempty"`
	Domain          string      `json:"domain,omitempty"`
	Scope           string      `json:"scope,omitempty"`
	ResourceVersion string      `json:"resourceVersion,omitempty"`
	ResumeToken     string      `json:"resumeToken,omitempty"`
}

// ServerMessage is the envelope sent back to websocket clients.
type ServerMessage struct {
	Type            MessageType                     `json:"type"`
	ClusterID       string                          `json:"clusterId,omitempty"`
	ClusterName     string                          `json:"clusterName,omitempty"`
	Domain          string                          `json:"domain,omitempty"`
	Scope           string                          `json:"scope,omitempty"`
	ResourceVersion string                          `json:"resourceVersion,omitempty"`
	Sequence        string                          `json:"sequence,omitempty"`
	UID             string                          `json:"uid,omitempty"`
	Name            string                          `json:"name,omitempty"`
	Namespace       string                          `json:"namespace,omitempty"`
	Kind            string                          `json:"kind,omitempty"`
	Row             interface{}                     `json:"row,omitempty"`
	Error           string                          `json:"error,omitempty"`
	ErrorDetails    *refresh.PermissionDeniedStatus `json:"errorDetails,omitempty"`
}

// Subscription captures an active stream subscription.
type Subscription struct {
	Domain  string
	Scope   string
	Updates <-chan ServerMessage
	Drops   <-chan DropReason
	Cancel  func()
}
