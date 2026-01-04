package streammux

import (
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/refresh"
)

type stubConn struct{}

func (stubConn) ReadJSON(interface{}) error       { return nil }
func (stubConn) WriteJSON(interface{}) error      { return nil }
func (stubConn) SetWriteDeadline(time.Time) error { return nil }
func (stubConn) Close() error                     { return nil }

// stubAdapter satisfies the stream Adapter interface for tests.
type stubAdapter struct{}

func (stubAdapter) NormalizeScope(_, scope string) (string, error) { return scope, nil }
func (stubAdapter) Subscribe(_, _ string) (*Subscription, error)   { return nil, nil }
func (stubAdapter) Resume(_, _ string, _ uint64) ([]ServerMessage, bool) {
	return nil, false
}

func TestSessionBackpressureKeepsSessionOpenAndResetsScope(t *testing.T) {
	session := newSession(stubConn{}, nil, noopLogger{}, nil, "cluster-1", "cluster-a", "resources", true, false, nil)
	for i := 0; i < outgoingBuffer; i++ {
		session.outgoing <- ServerMessage{
			Type:   MessageTypeAdded,
			Domain: "pods",
			Scope:  "default",
		}
	}

	session.enqueue(ServerMessage{
		Type:   MessageTypeModified,
		Domain: "pods",
		Scope:  "default",
	})

	select {
	case <-session.done:
		t.Fatal("expected session to remain open under backpressure")
	default:
	}

	foundReset := false
	for i := 0; i < outgoingBuffer; i++ {
		select {
		case msg := <-session.outgoing:
			if msg.Type == MessageTypeReset && msg.Domain == "pods" && msg.Scope == "default" {
				foundReset = true
			}
		default:
			t.Fatalf("expected %d queued messages, got %d", outgoingBuffer, i)
		}
	}

	if !foundReset {
		t.Fatal("expected reset message after backpressure")
	}
}

func TestSessionSendErrorIncludesPermissionDetails(t *testing.T) {
	session := newSession(stubConn{}, nil, noopLogger{}, nil, "cluster-1", "cluster-a", "resources", true, false, nil)
	err := refresh.NewPermissionDeniedError("pods", "core/pods")
	session.sendError("cluster-1", "pods", "namespace:default", err)

	msg := <-session.outgoing
	if msg.ErrorDetails == nil {
		t.Fatal("expected permission denied details to be included")
	}
	if msg.ErrorDetails.Details.Domain != "pods" || msg.ErrorDetails.Details.Resource != "core/pods" {
		t.Fatalf("unexpected error details: %+v", msg.ErrorDetails.Details)
	}
}

func TestHandlerSetsHandshakeTimeout(t *testing.T) {
	handler, err := NewHandler(Config{
		Adapter:    stubAdapter{},
		StreamName: "resources",
	})
	if err != nil {
		t.Fatalf("unexpected handler error: %v", err)
	}
	if handler.upgrader.HandshakeTimeout != handshakeTimeout {
		t.Fatalf("expected handshake timeout %v, got %v", handshakeTimeout, handler.upgrader.HandshakeTimeout)
	}
}
