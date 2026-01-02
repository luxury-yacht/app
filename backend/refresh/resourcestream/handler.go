package resourcestream

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/logstream"
	"github.com/luxury-yacht/app/backend/refresh/snapshot"
	"github.com/luxury-yacht/app/backend/refresh/telemetry"
)

const (
	writeTimeout   = 10 * time.Second
	outgoingBuffer = 512
)

type wsConn interface {
	ReadJSON(v interface{}) error
	WriteJSON(v interface{}) error
	SetWriteDeadline(time.Time) error
	Close() error
}

// Handler exposes the websocket resource stream endpoint.
type Handler struct {
	manager     *Manager
	telemetry   *telemetry.Recorder
	logger      logstream.Logger
	clusterMeta snapshot.ClusterMeta
	upgrader    websocket.Upgrader
}

// NewHandler constructs a websocket handler for resource streams.
func NewHandler(manager *Manager, logger logstream.Logger, recorder *telemetry.Recorder, meta snapshot.ClusterMeta) (*Handler, error) {
	if manager == nil {
		return nil, errors.New("resource stream manager is required")
	}
	if logger == nil {
		logger = noopLogger{}
	}
	return &Handler{
		manager:   manager,
		telemetry: recorder,
		logger:    logger,
		clusterMeta: meta,
		upgrader: websocket.Upgrader{
			ReadBufferSize:  4096,
			WriteBufferSize: 4096,
			CheckOrigin:     func(r *http.Request) bool { return true },
		},
	}, nil
}

// ServeHTTP upgrades the connection and multiplexes resource subscriptions.
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	conn, err := h.upgrader.Upgrade(w, r, nil)
	if err != nil {
		h.logger.Warn(fmt.Sprintf("resource stream upgrade failed: %v", err), "ResourceStream")
		return
	}

	if h.telemetry != nil {
		h.telemetry.RecordStreamConnect(telemetry.StreamResources)
		defer h.telemetry.RecordStreamDisconnect(telemetry.StreamResources)
	}

	session := newSession(conn, h.manager, h.logger, h.telemetry, h.clusterMeta)
	session.run(r.Context())
}

type session struct {
	conn        wsConn
	manager     *Manager
	logger      logstream.Logger
	telemetry   *telemetry.Recorder
	clusterMeta snapshot.ClusterMeta

	mu        sync.Mutex
	subs      map[string]*Subscription
	outgoing  chan ServerMessage
	done      chan struct{}
	closeOnce sync.Once
}

func newSession(conn wsConn, manager *Manager, logger logstream.Logger, recorder *telemetry.Recorder, meta snapshot.ClusterMeta) *session {
	return &session{
		conn:        conn,
		manager:     manager,
		logger:      logger,
		telemetry:   recorder,
		clusterMeta: meta,
		subs:        make(map[string]*Subscription),
		outgoing:    make(chan ServerMessage, outgoingBuffer),
		done:        make(chan struct{}),
	}
}

func (s *session) run(ctx context.Context) {
	go s.writeLoop(ctx)
	s.readLoop()
	s.shutdown()
}

func (s *session) shutdown() {
	s.closeOnce.Do(func() {
		close(s.done)
		s.mu.Lock()
		for _, sub := range s.subs {
			sub.Cancel()
		}
		s.subs = make(map[string]*Subscription)
		s.mu.Unlock()
		_ = s.conn.Close()
	})
}

func (s *session) readLoop() {
	for {
		var msg ClientMessage
		if err := s.conn.ReadJSON(&msg); err != nil {
			if !websocket.IsUnexpectedCloseError(err) {
				return
			}
			s.logger.Warn(fmt.Sprintf("resource stream read error: %v", err), "ResourceStream")
			return
		}

		switch msg.Type {
		case MessageTypeRequest:
			s.handleSubscribe(msg)
		case MessageTypeCancel:
			s.handleCancel(msg)
		default:
			s.sendError(msg.Domain, msg.Scope, "unsupported request type")
		}
	}
}

func (s *session) handleSubscribe(msg ClientMessage) {
	if msg.Domain == "" {
		s.sendError(msg.Domain, msg.Scope, "domain and scope are required")
		return
	}
	if msg.Scope == "" && msg.Domain != domainNodes {
		s.sendError(msg.Domain, msg.Scope, "domain and scope are required")
		return
	}

	if msg.ClusterID != "" && msg.ClusterID != s.clusterMeta.ClusterID {
		s.sendError(msg.Domain, msg.Scope, "cluster mismatch")
		return
	}

	_, trimmed := refresh.SplitClusterScope(msg.Scope)
	normalized, err := normalizeScopeForDomain(msg.Domain, trimmed)
	if err != nil {
		s.sendError(msg.Domain, msg.Scope, err.Error())
		return
	}

	sub, err := s.manager.Subscribe(msg.Domain, normalized)
	if err != nil {
		s.sendError(msg.Domain, msg.Scope, err.Error())
		return
	}

	key := subscriptionKey(msg.Domain, normalized)
	s.storeSubscription(key, sub)

	s.enqueue(ServerMessage{
		Type:        MessageTypeReset,
		Domain:      msg.Domain,
		Scope:       normalized,
		ClusterID:   s.clusterMeta.ClusterID,
		ClusterName: s.clusterMeta.ClusterName,
	})

	go s.forwardSubscription(sub)
}

func (s *session) handleCancel(msg ClientMessage) {
	if msg.Domain == "" {
		s.sendError(msg.Domain, msg.Scope, "domain and scope are required")
		return
	}
	if msg.Scope == "" && msg.Domain != domainNodes {
		s.sendError(msg.Domain, msg.Scope, "domain and scope are required")
		return
	}

	_, trimmed := refresh.SplitClusterScope(msg.Scope)
	normalized, err := normalizeScopeForDomain(msg.Domain, trimmed)
	if err != nil {
		s.sendError(msg.Domain, msg.Scope, err.Error())
		return
	}

	key := subscriptionKey(msg.Domain, normalized)
	s.mu.Lock()
	sub := s.subs[key]
	delete(s.subs, key)
	s.mu.Unlock()
	if sub == nil {
		return
	}
	sub.Cancel()
}

func (s *session) storeSubscription(key string, sub *Subscription) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if existing := s.subs[key]; existing != nil {
		existing.Cancel()
	}
	s.subs[key] = sub
}

func (s *session) forwardSubscription(sub *Subscription) {
	for {
		select {
		case update, ok := <-sub.Updates:
			if !ok {
				return
			}
			s.enqueue(updateToMessage(update))
		case reason, ok := <-sub.Drops:
			if !ok {
				return
			}
			s.enqueue(ServerMessage{
				Type:        MessageTypeComplete,
				Domain:      sub.Domain,
				Scope:       sub.Scope,
				ClusterID:   s.clusterMeta.ClusterID,
				ClusterName: s.clusterMeta.ClusterName,
				Error:       fmt.Sprintf("subscription ended: %s", reason),
			})
			return
		case <-s.done:
			return
		}
	}
}

func (s *session) enqueue(msg ServerMessage) {
	select {
	case s.outgoing <- msg:
	default:
		s.logger.Warn("resource stream: outgoing buffer full, closing connection", "ResourceStream")
		s.shutdown()
	}
}

func (s *session) writeLoop(ctx context.Context) {
	heartbeat := time.NewTicker(config.StreamHeartbeatInterval)
	defer heartbeat.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-s.done:
			return
		case msg := <-s.outgoing:
			if err := s.writeMessage(msg); err != nil {
				return
			}
		case <-heartbeat.C:
			if err := s.writeMessage(ServerMessage{
				Type:        MessageTypeHeartbeat,
				ClusterID:   s.clusterMeta.ClusterID,
				ClusterName: s.clusterMeta.ClusterName,
			}); err != nil {
				return
			}
		}
	}
}

func (s *session) writeMessage(msg ServerMessage) error {
	if err := s.conn.SetWriteDeadline(time.Now().Add(writeTimeout)); err != nil {
		s.logger.Warn(fmt.Sprintf("resource stream: write deadline failed: %v", err), "ResourceStream")
	}
	if err := s.conn.WriteJSON(msg); err != nil {
		s.logger.Warn(fmt.Sprintf("resource stream write error: %v", err), "ResourceStream")
		s.shutdown()
		return err
	}
	return nil
}

func (s *session) sendError(domain, scope, message string) {
	msg := ServerMessage{
		Type:        MessageTypeError,
		Domain:      domain,
		Scope:       scope,
		ClusterID:   s.clusterMeta.ClusterID,
		ClusterName: s.clusterMeta.ClusterName,
		Error:       message,
	}
	s.enqueue(msg)
}

func updateToMessage(update Update) ServerMessage {
	return ServerMessage{
		Type:            update.Type,
		ClusterID:       update.ClusterID,
		ClusterName:     update.ClusterName,
		Domain:          update.Domain,
		Scope:           update.Scope,
		ResourceVersion: update.ResourceVersion,
		UID:             update.UID,
		Name:            update.Name,
		Namespace:       update.Namespace,
		Kind:            update.Kind,
		Row:             update.Row,
	}
}

func subscriptionKey(domain, scope string) string {
	return strings.TrimSpace(domain) + "|" + strings.TrimSpace(scope)
}
