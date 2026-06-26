package streammux

import (
	"testing"

	"github.com/stretchr/testify/require"
)

// TestSignalEnvelopePopulation locks the A1 doorbell taxonomy: the internal
// MessageType maps to a public {source, signal} pair. Data changes are object
// "changed", scope resyncs are "reset", errors are "error", and control frames
// carry no signal/source.
func TestSignalEnvelopePopulation(t *testing.T) {
	cases := []struct {
		msgType    MessageType
		wantSignal Signal
		wantSource Source
	}{
		{MessageTypeAdded, SignalChanged, SourceObject},
		{MessageTypeModified, SignalChanged, SourceObject},
		{MessageTypeDeleted, SignalChanged, SourceObject},
		{MessageTypeComplete, SignalReset, SourceObject},
		{MessageTypeReset, SignalReset, SourceObject},
		{MessageTypeError, SignalError, ""},
		{MessageTypeHeartbeat, "", ""},
		{MessageTypeAck, "", ""},
	}
	for _, tc := range cases {
		got := withSignalEnvelope(ServerMessage{Type: tc.msgType})
		require.Equalf(t, tc.wantSignal, got.Signal, "%s signal", tc.msgType)
		require.Equalf(t, tc.wantSource, got.Source, "%s source", tc.msgType)
	}
}

// TestSignalEnvelopePreservesExplicitProducerValues guards the A2/A3 path: when
// a producer sets a non-object source (events/catalog folding onto this WS), the
// send chokepoint must not overwrite it with the object default.
func TestSignalEnvelopePreservesExplicitProducerValues(t *testing.T) {
	got := withSignalEnvelope(ServerMessage{
		Type:   MessageTypeModified,
		Source: Source("event"),
		Signal: SignalChanged,
	})
	require.Equal(t, Source("event"), got.Source)
	require.Equal(t, SignalChanged, got.Signal)
}
