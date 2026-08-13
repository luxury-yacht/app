package streammux

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/internal/applog"
	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/refresh"
)

type stubConn struct{}

func (stubConn) ReceiveJSON(interface{}) error { return nil }
func (stubConn) SendJSON(interface{}) error    { return nil }
func (stubConn) Close() error                  { return nil }

type blockingConn struct {
	started   chan struct{}
	closed    chan struct{}
	startOnce sync.Once
	closeOnce sync.Once
}

func newBlockingConn() *blockingConn {
	return &blockingConn{started: make(chan struct{}), closed: make(chan struct{})}
}

func (c *blockingConn) ReceiveJSON(interface{}) error {
	c.startOnce.Do(func() { close(c.started) })
	<-c.closed
	return errors.New("stream closed")
}

func (c *blockingConn) SendJSON(interface{}) error { return nil }

func (c *blockingConn) Close() error {
	c.closeOnce.Do(func() { close(c.closed) })
	return nil
}

// stubAdapter satisfies the stream Adapter interface for tests.
type stubAdapter struct{}

type stubSelector struct {
	clusterID string
	domain    string
	scope     string
}

func (s stubSelector) Cluster() string        { return s.clusterID }
func (s stubSelector) DomainName() string     { return s.domain }
func (s stubSelector) CanonicalScope() string { return s.scope }

func (stubAdapter) ParseSelector(clusterID, domain, scope string) (Selector, error) {
	return stubSelector{clusterID: clusterID, domain: domain, scope: scope}, nil
}

func (stubAdapter) Subscribe(Selector) (*Subscription, error) { return nil, nil }
func (stubAdapter) Resume(Selector, uint64) ([]ServerMessage, bool) {
	return nil, false
}

func TestSessionBackpressureKeepsSessionOpenAndResetsScope(t *testing.T) {
	session := newSession(stubConn{}, Config{Adapter: nil, Logger: applog.Noop, Telemetry: nil, ClusterID: "cluster-1", ClusterName: "cluster-a", StreamName: "resources", SendReset: true, AllowClusterScopedRequests: false, ResolveClusterName: nil})
	// Match production buffer sizing for backpressure behavior.
	for i := 0; i < config.StreamMuxOutgoingBufferSize; i++ {
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
	for i := 0; i < config.StreamMuxOutgoingBufferSize; i++ {
		select {
		case msg := <-session.outgoing:
			if msg.Type == MessageTypeReset && msg.Domain == "pods" && msg.Scope == "default" {
				if msg.Source != SourceObject {
					t.Fatalf("expected reset source %q, got %q", SourceObject, msg.Source)
				}
				if msg.Signal != SignalReset {
					t.Fatalf("expected reset signal %q, got %q", SignalReset, msg.Signal)
				}
				if msg.Version == "" {
					t.Fatal("expected reset version")
				}
				foundReset = true
			}
		default:
			t.Fatalf("expected %d queued messages, got %d", config.StreamMuxOutgoingBufferSize, i)
		}
	}

	if !foundReset {
		t.Fatal("expected reset message after backpressure")
	}
}

func TestHandlerStopClosesActiveAndFutureSessions(t *testing.T) {
	handler, err := NewHandler(Config{
		Adapter: stubAdapter{}, Logger: applog.Noop, StreamName: "resources",
	})
	if err != nil {
		t.Fatalf("NewHandler returned error: %v", err)
	}
	active := newBlockingConn()
	done := make(chan struct{})
	go func() {
		defer close(done)
		handler.Handle(active, context.Background())
	}()

	select {
	case <-active.started:
	case <-time.After(time.Second):
		t.Fatal("active session did not start")
	}
	handler.Stop()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("active session survived handler teardown")
	}

	future := newBlockingConn()
	handler.Handle(future, context.Background())
	select {
	case <-future.closed:
	default:
		t.Fatal("session started after handler teardown")
	}
}

func TestSessionSendErrorIncludesPermissionDetails(t *testing.T) {
	session := newSession(stubConn{}, Config{Adapter: nil, Logger: applog.Noop, Telemetry: nil, ClusterID: "cluster-1", ClusterName: "cluster-a", StreamName: "resources", SendReset: true, AllowClusterScopedRequests: false, ResolveClusterName: nil})
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

func TestSessionResolveClusterIDRejectsMultiClusterScope(t *testing.T) {
	session := newSession(stubConn{}, Config{Adapter: stubAdapter{}, Logger: applog.Noop, Telemetry: nil, ClusterID: "", ClusterName: "", StreamName: "resources", SendReset: true, AllowClusterScopedRequests: true, ResolveClusterName: nil})

	_, err := session.resolveClusterID(ClientMessage{
		ClusterID: "cluster-a",
		Scope:     "clusters=cluster-a,cluster-b|namespace:default",
	})

	if err == nil || err.Error() != "stream scope must target a single cluster" {
		t.Fatalf("expected single-cluster scope error, got %v", err)
	}
}

func TestSessionResolveClusterIDRequiresScopeClusterToMatchMessageCluster(t *testing.T) {
	session := newSession(stubConn{}, Config{Adapter: stubAdapter{}, Logger: applog.Noop, Telemetry: nil, ClusterID: "", ClusterName: "", StreamName: "resources", SendReset: true, AllowClusterScopedRequests: true, ResolveClusterName: nil})

	_, err := session.resolveClusterID(ClientMessage{
		ClusterID: "cluster-a",
		Scope:     "cluster-b|namespace:default",
	})

	if err == nil || err.Error() != "cluster mismatch" {
		t.Fatalf("expected cluster mismatch, got %v", err)
	}
}

func TestSessionResolveClusterIDRejectsMismatchedScopeForSingleClusterHandler(t *testing.T) {
	session := newSession(stubConn{}, Config{Adapter: stubAdapter{}, Logger: applog.Noop, Telemetry: nil, ClusterID: "cluster-a", ClusterName: "", StreamName: "resources", SendReset: true, AllowClusterScopedRequests: false, ResolveClusterName: nil})

	_, err := session.resolveClusterID(ClientMessage{
		Scope: "cluster-b|namespace:default",
	})

	if err == nil || err.Error() != "cluster mismatch" {
		t.Fatalf("expected cluster mismatch, got %v", err)
	}
}

// ackStubAdapter accepts every subscribe and lets the test control resume results.
type ackStubAdapter struct {
	resumeUpdates []ServerMessage
	resumeOK      bool
}

func (ackStubAdapter) ParseSelector(clusterID, domain, scope string) (Selector, error) {
	return stubSelector{clusterID: clusterID, domain: domain, scope: scope}, nil
}

func (ackStubAdapter) Subscribe(Selector) (*Subscription, error) {
	return &Subscription{
		Updates: make(chan ServerMessage),
		Drops:   make(chan DropReason),
		Cancel:  func() {},
	}, nil
}

func (a ackStubAdapter) Resume(Selector, uint64) ([]ServerMessage, bool) {
	return a.resumeUpdates, a.resumeOK
}

func drainOutgoingTypes(s *session) []MessageType {
	types := []MessageType{}
	for {
		select {
		case msg := <-s.outgoing:
			types = append(types, msg.Type)
		default:
			return types
		}
	}
}

// Every ACCEPTED subscribe must be positively confirmed to the client with an
// ACK frame — the frontend anchors its "synchronized" stream health on it. The
// resume-with-no-buffered-updates case previously produced NO frame at all,
// leaving the client unable to distinguish an accepted subscribe from an
// ignored one.
func TestHandleSubscribeAcksEveryAcceptedSubscribe(t *testing.T) {
	// Fresh subscribe: ACK then RESET.
	fresh := newSession(stubConn{}, Config{Adapter: ackStubAdapter{}, Logger: applog.Noop, Telemetry: nil, ClusterID: "cluster-1", ClusterName: "cluster-a", StreamName: "resources", SendReset: true, AllowClusterScopedRequests: false, ResolveClusterName: nil})
	fresh.handleSubscribe(ClientMessage{Type: MessageTypeRequest, ClusterID: "cluster-1", Domain: "namespaces", Scope: ""})
	freshTypes := drainOutgoingTypes(fresh)
	if len(freshTypes) < 2 || freshTypes[0] != MessageTypeAck || freshTypes[1] != MessageTypeReset {
		t.Fatalf("fresh subscribe must send ACK then RESET, got %v", freshTypes)
	}

	// Resumed subscribe with ZERO buffered updates: still ACKs (no RESET needed).
	resumed := newSession(stubConn{}, Config{Adapter: ackStubAdapter{resumeOK: true}, Logger: applog.Noop, Telemetry: nil, ClusterID: "cluster-1", ClusterName: "cluster-a", StreamName: "resources", SendReset: true, AllowClusterScopedRequests: false, ResolveClusterName: nil})
	resumed.handleSubscribe(ClientMessage{Type: MessageTypeRequest, ClusterID: "cluster-1", Domain: "pods", Scope: "namespace:default", ResumeToken: "7"})
	resumedTypes := drainOutgoingTypes(resumed)
	if len(resumedTypes) != 1 || resumedTypes[0] != MessageTypeAck {
		t.Fatalf("resumed-empty subscribe must send exactly ACK, got %v", resumedTypes)
	}
}
