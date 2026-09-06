package streammux

import (
	"context"
	"errors"
	"fmt"
	"slices"
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

func TestSessionBackpressureDisconnectsBeforeSilentlyLosingSignals(t *testing.T) {
	s := newSession(stubConn{}, Config{Logger: applog.Noop, StreamName: "resources"})
	s.outgoing = make(chan ServerMessage, 2)
	s.enqueue(ServerMessage{Type: MessageTypeModified, Domain: "pods", Scope: "namespace:quiet", ClusterID: "cluster-a"})
	s.enqueue(ServerMessage{Type: MessageTypeModified, Domain: "nodes", Scope: "", ClusterID: "cluster-b"})
	s.enqueue(ServerMessage{Type: MessageTypeModified, Domain: "nodes", Scope: "", ClusterID: "cluster-b"})
	select {
	case <-s.done:
	default:
		t.Fatal("overflow must disconnect so every scope reconciles on reconnect")
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

func TestSessionOversizedResourceResumeResetsWithoutDisconnecting(t *testing.T) {
	for _, queued := range []int{0, config.StreamMuxOutgoingBufferSize - 2} {
		t.Run(fmt.Sprintf("queued=%d", queued), func(t *testing.T) {
			updates := make([]ServerMessage, config.ResourceStreamResumeBufferSize)
			for i := range updates {
				updates[i] = ServerMessage{Type: MessageTypeModified, Domain: "pods", Scope: "namespace:default", Sequence: fmt.Sprint(i + 2)}
			}
			s := newSession(stubConn{}, Config{
				Adapter: ackStubAdapter{resumeOK: true, resumeUpdates: updates}, Logger: applog.Noop,
				ClusterID: "cluster-a", StreamName: "resources", SendReset: true,
			})
			t.Cleanup(s.shutdown)
			// No writer drains this queue: model a stalled renderer during resume.
			for range queued {
				s.enqueue(ServerMessage{Type: MessageTypeModified, Domain: "nodes", ClusterID: "cluster-a"})
			}
			s.handleSubscribe(ClientMessage{Type: MessageTypeRequest, Domain: "pods", Scope: "namespace:default", ResumeToken: "1"})
			select {
			case <-s.done:
				t.Fatal("oversized replay disconnected; reconnect would replay the same backlog again")
			default:
			}
			for range queued {
				if msg := <-s.outgoing; msg.Domain != "nodes" {
					t.Fatalf("another scope's queued update was lost: %+v", msg)
				}
			}
			if types := drainOutgoingTypes(s); !slices.Equal(types, []MessageType{MessageTypeAck, MessageTypeReset}) {
				t.Fatalf("expected ACK then RESET, got %v", types)
			}
		})
	}
}

func TestSessionResourceResumeThatFitsPreservesEveryFrame(t *testing.T) {
	updates := make([]ServerMessage, config.StreamMuxOutgoingBufferSize-1)
	for i := range updates {
		updates[i] = ServerMessage{Type: MessageTypeModified, Domain: "pods", Scope: "namespace:default", Sequence: fmt.Sprint(i + 2)}
	}
	s := newSession(stubConn{}, Config{
		Adapter: ackStubAdapter{resumeOK: true, resumeUpdates: updates}, Logger: applog.Noop,
		ClusterID: "cluster-a", StreamName: "resources", SendReset: true,
	})
	t.Cleanup(s.shutdown)
	s.handleSubscribe(ClientMessage{Type: MessageTypeRequest, Domain: "pods", Scope: "namespace:default", ResumeToken: "1"})
	if msg := <-s.outgoing; msg.Type != MessageTypeAck {
		t.Fatalf("expected ACK before replay, got %+v", msg)
	}
	for _, expected := range updates {
		msg := <-s.outgoing
		if msg.Type != expected.Type || msg.Sequence != expected.Sequence || msg.ClusterID != "cluster-a" {
			t.Fatalf("replay changed or lost a frame: %+v", msg)
		}
	}
	if len(s.outgoing) != 0 || s.doneError() != nil {
		t.Fatal("a replay that fits must keep the session open without a reset")
	}
}

type channelConn struct {
	requests  chan ClientMessage
	responses chan ServerMessage
	closed    chan struct{}
	closeOnce sync.Once
}

func (c *channelConn) ReceiveJSON(value interface{}) error {
	select {
	case msg := <-c.requests:
		*value.(*ClientMessage) = msg
		return nil
	case <-c.closed:
		return errors.New("connection closed")
	}
}

func (c *channelConn) SendJSON(value interface{}) error {
	select {
	case c.responses <- value.(ServerMessage):
		return nil
	case <-c.closed:
		return errors.New("connection closed")
	}
}

func (c *channelConn) Close() error {
	c.closeOnce.Do(func() { close(c.closed) })
	return nil
}

type liveResumeAdapter struct {
	ackStubAdapter
	sub *Subscription
}

func (a liveResumeAdapter) Subscribe(Selector) (*Subscription, error) { return a.sub, nil }

func TestSessionOversizedResumeContinuesLiveDeliveryAndCancellation(t *testing.T) {
	backlog := make([]ServerMessage, config.ResourceStreamResumeBufferSize)
	for i := range backlog {
		backlog[i] = ServerMessage{Type: MessageTypeModified, Domain: "pods", Scope: "namespace:default", Sequence: fmt.Sprint(i + 2)}
	}
	updates := make(chan ServerMessage, 2)
	canceled := make(chan struct{})
	var cancelOnce sync.Once
	sub := &Subscription{
		Domain: "pods", Scope: "namespace:default", Updates: updates,
		Cancel: func() { cancelOnce.Do(func() { close(canceled); close(updates) }) },
	}
	handler, err := NewHandler(Config{
		Adapter: liveResumeAdapter{ackStubAdapter: ackStubAdapter{resumeOK: true, resumeUpdates: backlog}, sub: sub},
		Logger:  applog.Noop, ClusterID: "cluster-a", StreamName: "resources", SendReset: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	conn := &channelConn{
		requests: make(chan ClientMessage, 1), responses: make(chan ServerMessage), closed: make(chan struct{}),
	}
	done := make(chan struct{})
	go func() { defer close(done); handler.Handle(conn, context.Background()) }()
	t.Cleanup(func() {
		handler.Stop()
		select {
		case <-done:
		case <-time.After(time.Second):
			t.Error("session did not stop")
		}
	})
	read := func() ServerMessage {
		t.Helper()
		select {
		case msg := <-conn.responses:
			return msg
		case <-conn.closed:
			t.Fatal("session disconnected")
		case <-time.After(time.Second):
			t.Fatal("session delivery stalled")
		}
		return ServerMessage{}
	}
	conn.requests <- ClientMessage{Type: MessageTypeRequest, Domain: "pods", Scope: "namespace:default", ResumeToken: "1"}
	for _, expected := range []MessageType{MessageTypeAck, MessageTypeReset} {
		if msg := read(); msg.Type != expected || msg.ClusterID != "cluster-a" {
			t.Fatalf("unexpected handshake: %+v", msg)
		}
	}
	// Live delivery overlaps the replay tail. It must skip the duplicate, then
	// deliver the first new sequence over the same connection after RESET.
	updates <- backlog[len(backlog)-1]
	live := ServerMessage{Type: MessageTypeModified, Domain: "pods", Scope: "namespace:default", Sequence: fmt.Sprint(len(backlog) + 2)}
	updates <- live
	if msg := read(); msg.Type != live.Type || msg.Sequence != live.Sequence || msg.ClusterID != "cluster-a" {
		t.Fatalf("live delivery did not resume after RESET: %+v", msg)
	}
	conn.requests <- ClientMessage{Type: MessageTypeCancel, Domain: "pods", Scope: "namespace:default"}
	select {
	case <-canceled:
	case <-time.After(time.Second):
		t.Fatal("client cancellation was not processed after replay")
	}
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

func TestClosedSubscriptionAlwaysNotifiesClient(t *testing.T) {
	missing := 0
	for i := 0; i < 100; i++ {
		s := newSession(stubConn{}, Config{Logger: applog.Noop, StreamName: "resources"})
		updates := make(chan ServerMessage)
		drops := make(chan DropReason, 1)
		drops <- DropReasonClosed
		close(drops)
		close(updates)
		s.subs["test"] = &sessionSubscription{sub: &Subscription{Domain: "pods", Scope: "namespace:default", Updates: updates, Drops: drops, Cancel: func() {}}, clusterID: "cluster-a"}
		s.forwardSubscription("test", s.subs["test"], 0)
		if len(s.outgoing) == 0 {
			missing++
		}
	}
	if missing != 0 {
		t.Fatalf("%d/100 closed subscriptions emitted no COMPLETE frame", missing)
	}
}

func TestForwardSubscriptionPreservesCompletionReason(t *testing.T) {
	closed := make(chan DropReason)
	close(closed)
	queued := make(chan DropReason, 1)
	queued <- DropReasonBackpressure
	close(queued)
	for _, test := range []struct {
		name  string
		drops <-chan DropReason
		want  DropReason
	}{
		{name: "absent", want: DropReasonClosed},
		{name: "open without reason", drops: make(chan DropReason), want: DropReasonClosed},
		{name: "closed without reason", drops: closed, want: DropReasonClosed},
		{name: "queued reason", drops: queued, want: DropReasonBackpressure},
	} {
		t.Run(test.name, func(t *testing.T) {
			s := newSession(stubConn{}, Config{Logger: applog.Noop})
			updates := make(chan ServerMessage)
			close(updates)
			entry := s.storeSubscription("key", &Subscription{
				Domain: "pods", Updates: updates, Drops: test.drops, Cancel: func() {},
			}, "cluster-a", "")
			s.forwardSubscription("key", entry, 0)
			if len(s.outgoing) != 1 {
				t.Fatalf("expected one completion, got %d messages", len(s.outgoing))
			}
			msg := <-s.outgoing
			if msg.Type != MessageTypeComplete || msg.Error != "subscription ended: "+string(test.want) {
				t.Fatalf("completion lost the drop reason: %+v", msg)
			}
		})
	}
}

func TestForwardSubscriptionPreservesUnsequencedLiveUpdates(t *testing.T) {
	s := newSession(stubConn{}, Config{Logger: applog.Noop})
	updates := make(chan ServerMessage, 3)
	for _, sequence := range []string{"7", "invalid", "9"} {
		updates <- ServerMessage{Type: MessageTypeModified, Domain: "pods", Sequence: sequence}
	}
	close(updates)
	entry := s.storeSubscription("key", &Subscription{
		Domain: "pods", Updates: updates, Cancel: func() {},
	}, "cluster-a", "")
	s.forwardSubscription("key", entry, 8)
	if len(s.outgoing) != 3 {
		t.Fatalf("expected unsequenced and new live updates, then completion; got %d messages", len(s.outgoing))
	}
	for _, sequence := range []string{"invalid", "9"} {
		if msg := <-s.outgoing; msg.Type != MessageTypeModified || msg.Sequence != sequence {
			t.Fatalf("unexpected live update after replay: %+v", msg)
		}
	}
	if msg := <-s.outgoing; msg.Type != MessageTypeComplete {
		t.Fatalf("expected completion after live updates, got %+v", msg)
	}
}

func TestOldSubscriptionCannotDeliverIntoReplacement(t *testing.T) {
	s := newSession(stubConn{}, Config{Logger: applog.Noop, StreamName: "resources"})
	updates := make(chan ServerMessage)
	drops := make(chan DropReason, 1)
	drops <- DropReasonClosed
	close(drops)
	close(updates)
	old := s.storeSubscription("key", &Subscription{Domain: "pods", Updates: updates, Drops: drops, Cancel: func() {}}, "cluster-a", "")
	next := s.storeSubscription("key", &Subscription{Domain: "pods", Cancel: func() {}}, "cluster-a", "")
	s.forwardSubscription("key", old, 0)
	if len(s.outgoing) != 0 {
		t.Fatal("old completion reached the replacement")
	}
	if s.subs["key"] != next {
		t.Fatal("old completion removed the replacement")
	}
	if s.deliverSubscriptionMessage("key", old, ServerMessage{Type: MessageTypeModified}, false) {
		t.Fatal("old data reached the replacement")
	}
}

func TestLateSubscriptionCannotOutliveSessionShutdown(t *testing.T) {
	s := newSession(stubConn{}, Config{Logger: applog.Noop})
	s.shutdown()
	canceled := false
	entry := s.storeSubscription("late", &Subscription{Cancel: func() { canceled = true }}, "cluster-a", "Alpha")
	if entry != nil || !canceled || len(s.subs) != 0 {
		t.Fatal("late subscription survived a closed session")
	}
}
