package resourcestream

import "github.com/luxury-yacht/app/backend/refresh/streammux"

// MessageType represents the message type used for requests and updates.
type MessageType = streammux.MessageType

const (
	MessageTypeRequest   = streammux.MessageTypeRequest
	MessageTypeCancel    = streammux.MessageTypeCancel
	MessageTypeAck       = streammux.MessageTypeAck
	MessageTypeError     = streammux.MessageTypeError
	MessageTypeHeartbeat = streammux.MessageTypeHeartbeat
	MessageTypeReset     = streammux.MessageTypeReset
	MessageTypeComplete  = streammux.MessageTypeComplete
	MessageTypeAdded     = streammux.MessageTypeAdded
	MessageTypeModified  = streammux.MessageTypeModified
	MessageTypeDeleted   = streammux.MessageTypeDeleted
)

// Source is the doorbell clock taxonomy, aliased from the envelope layer so a
// domain's authored SourceClocks reference one vocabulary across both packages.
type Source = streammux.Source

const (
	SourceObject  = streammux.SourceObject
	SourceMetric  = streammux.SourceMetric
	SourceEvent   = streammux.SourceEvent
	SourceCatalog = streammux.SourceCatalog
)

type Signal = streammux.Signal

const (
	SignalChanged = streammux.SignalChanged
	SignalReset   = streammux.SignalReset
	SignalError   = streammux.SignalError
)

// DropReason captures why a subscription was terminated.
type DropReason = streammux.DropReason

const (
	DropReasonBackpressure = streammux.DropReasonBackpressure
	DropReasonClosed       = streammux.DropReasonClosed
)

// ClientMessage is the request envelope sent from the websocket client.
type ClientMessage = streammux.ClientMessage

// ServerMessage is the envelope sent back to websocket clients.
type ServerMessage = streammux.ServerMessage

// Update is the internal payload emitted by the resource stream manager.
type Update = streammux.ServerMessage

// Subscription captures an active stream subscription.
type Subscription = streammux.Subscription
