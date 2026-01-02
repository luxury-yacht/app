package resourcestream

// MessageType represents the message type used for requests and updates.
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

// ClientMessage is the request envelope sent from the websocket client.
type ClientMessage struct {
	Type            MessageType `json:"type"`
	ClusterID       string      `json:"clusterId,omitempty"`
	Domain          string      `json:"domain,omitempty"`
	Scope           string      `json:"scope,omitempty"`
	ResourceVersion string      `json:"resourceVersion,omitempty"`
}

// ServerMessage is the envelope sent back to websocket clients.
type ServerMessage struct {
	Type            MessageType `json:"type"`
	ClusterID       string      `json:"clusterId,omitempty"`
	ClusterName     string      `json:"clusterName,omitempty"`
	Domain          string      `json:"domain,omitempty"`
	Scope           string      `json:"scope,omitempty"`
	ResourceVersion string      `json:"resourceVersion,omitempty"`
	UID             string      `json:"uid,omitempty"`
	Name            string      `json:"name,omitempty"`
	Namespace       string      `json:"namespace,omitempty"`
	Kind            string      `json:"kind,omitempty"`
	Row             interface{} `json:"row,omitempty"`
	Error           string      `json:"error,omitempty"`
}

// Update is the internal payload emitted by the resource stream manager.
type Update struct {
	Type            MessageType
	Domain          string
	Scope           string
	ClusterID       string
	ClusterName     string
	ResourceVersion string
	UID             string
	Name            string
	Namespace       string
	Kind            string
	Row             interface{}
}

// Subscription captures an active stream subscription.
type Subscription struct {
	Domain  string
	Scope   string
	Updates <-chan Update
	Drops   <-chan DropReason
	Cancel  func()
}
