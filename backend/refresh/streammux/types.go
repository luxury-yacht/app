package streammux

import (
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/resourcemodel"
)

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

// Source names the clock whose advance produced a doorbell signal, and is the
// canonical taxonomy referenced by a refresh domain's authored sourceClocks
// (see resourcestream.ProjectionDescriptor.SourceClocks, which aliases this
// type). object/metric are used today; event/catalog join as the events and
// catalog streams fold onto this WS.
type Source string

const (
	SourceObject  Source = "object"
	SourceMetric  Source = "metric"
	SourceEvent   Source = "event"
	SourceCatalog Source = "catalog"
)

// Signal is the public outcome a doorbell frame carries, formalizing the
// internal MessageType: "changed" means refetch if this source affects the
// query, "reset" means the resume position was lost so re-snapshot, and "error"
// feeds the terminal-error/diagnostics path.
type Signal string

const (
	SignalChanged Signal = "changed"
	SignalReset   Signal = "reset"
	SignalError   Signal = "error"
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
//
// The envelope carries only a change SIGNAL, never a projected row: every
// streamed table is query-backed, so the visible page is fetched over HTTP and
// the subscription exists only to learn WHEN to refetch. A changed object's
// identity travels through Ref (the previous top-level identity fields —
// UID/Name/Namespace/Kind/APIGroup/APIVersion — were removed; consumers must
// read identity from Ref). ClusterID and ClusterName stay on the envelope as
// routing metadata that applies to every message type (including control
// messages without a Ref).
type ServerMessage struct {
	Type            MessageType                     `json:"type"`
	ClusterID       string                          `json:"clusterId,omitempty"`
	ClusterName     string                          `json:"clusterName,omitempty"`
	Domain          string                          `json:"domain,omitempty"`
	Scope           string                          `json:"scope,omitempty"`
	Source          Source                          `json:"source,omitempty"`
	Version         string                          `json:"version,omitempty"`
	Signal          Signal                          `json:"signal,omitempty"`
	ResourceVersion string                          `json:"resourceVersion,omitempty"`
	Sequence        string                          `json:"sequence,omitempty"`
	Ref             *resourcemodel.ResourceRef      `json:"ref,omitempty"`
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
