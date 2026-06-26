package streammux

// withSignalEnvelope populates the public A1 doorbell {source, signal} pair from
// the internal MessageType, at the single send chokepoint, without overriding a
// source/signal a producer already set. The resources WS carries object-state
// signals; events/catalog producers fold onto this WS in A2/A3 and set their own
// non-object source before the frame reaches the chokepoint.
func withSignalEnvelope(msg ServerMessage) ServerMessage {
	if msg.Signal == "" {
		msg.Signal = signalForType(msg.Type)
	}
	if msg.Source == "" {
		msg.Source = sourceForType(msg.Type)
	}
	return msg
}

// signalForType maps the internal MessageType to its public Signal. Control
// frames (heartbeat/ack/request/cancel) carry no signal.
func signalForType(t MessageType) Signal {
	switch t {
	case MessageTypeAdded, MessageTypeModified, MessageTypeDeleted:
		return SignalChanged
	case MessageTypeComplete, MessageTypeReset:
		return SignalReset
	case MessageTypeError:
		return SignalError
	default:
		return ""
	}
}

// sourceForType returns the clock a resources-WS MessageType advances. Every
// object-state change and scope resync on this WS is the object clock; control
// and error frames are not a clock advance and carry no source.
func sourceForType(t MessageType) Source {
	switch t {
	case MessageTypeAdded, MessageTypeModified, MessageTypeDeleted, MessageTypeComplete, MessageTypeReset:
		return SourceObject
	default:
		return ""
	}
}
