package streammux

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

// Adapter provides domain-specific subscription and scope normalization logic.
type Adapter interface {
	NormalizeScope(domain, scope string) (string, error)
	Subscribe(domain, scope string) (*Subscription, error)
}

// Config captures the dependencies for a websocket stream multiplexer.
type Config struct {
	Adapter     Adapter
	Logger      logstream.Logger
	Telemetry   *telemetry.Recorder
	ClusterID   string
	ClusterName string
	StreamName  string
	SendReset   bool
}

// Handler exposes a websocket endpoint that multiplexes stream subscriptions.
type Handler struct {
	adapter     Adapter
	logger      logstream.Logger
	telemetry   *telemetry.Recorder
	clusterID   string
	clusterName string
	streamName  string
	sendReset   bool
	upgrader    websocket.Upgrader
}

// NewHandler constructs a websocket stream multiplexer handler.
func NewHandler(cfg Config) (*Handler, error) {
	if cfg.Adapter == nil {
		return nil, errors.New("stream adapter is required")
	}
	if cfg.Logger == nil {
		cfg.Logger = noopLogger{}
	}
	if cfg.StreamName == "" {
		return nil, errors.New("stream name is required")
	}
	return &Handler{
		adapter:     cfg.Adapter,
		logger:      cfg.Logger,
		telemetry:   cfg.Telemetry,
		clusterID:   cfg.ClusterID,
		clusterName: cfg.ClusterName,
		streamName:  cfg.StreamName,
		sendReset:   cfg.SendReset,
		upgrader: websocket.Upgrader{
			ReadBufferSize:  4096,
			WriteBufferSize: 4096,
			CheckOrigin:     func(r *http.Request) bool { return true },
		},
	}, nil
}

// ServeHTTP upgrades the connection and multiplexes stream subscriptions.
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	conn, err := h.upgrader.Upgrade(w, r, nil)
	if err != nil {
		h.logger.Warn(fmt.Sprintf("stream mux upgrade failed: %v", err), "StreamMux")
		return
	}

	if h.telemetry != nil {
		h.telemetry.RecordStreamConnect(h.streamName)
		defer h.telemetry.RecordStreamDisconnect(h.streamName)
	}

	session := newSession(conn, h.adapter, h.logger, h.clusterID, h.clusterName, h.streamName, h.sendReset)
	session.run(r.Context())
}

type session struct {
	conn        wsConn
	adapter     Adapter
	logger      logstream.Logger
	clusterID   string
	clusterName string
	streamName  string
	sendReset   bool

	mu        sync.Mutex
	subs      map[string]*Subscription
	outgoing  chan ServerMessage
	done      chan struct{}
	closeOnce sync.Once
}

func newSession(conn wsConn, adapter Adapter, logger logstream.Logger, clusterID, clusterName, streamName string, sendReset bool) *session {
	return &session{
		conn:        conn,
		adapter:     adapter,
		logger:      logger,
		clusterID:   clusterID,
		clusterName: clusterName,
		streamName:  streamName,
		sendReset:   sendReset,
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
			s.logger.Warn(fmt.Sprintf("stream mux read error: %v", err), "StreamMux")
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
		s.sendError(msg.Domain, msg.Scope, "domain is required")
		return
	}
	if msg.ClusterID != "" && msg.ClusterID != s.clusterID {
		s.sendError(msg.Domain, msg.Scope, "cluster mismatch")
		return
	}

	_, trimmed := refresh.SplitClusterScope(msg.Scope)
	normalized, err := s.adapter.NormalizeScope(msg.Domain, trimmed)
	if err != nil {
		s.sendError(msg.Domain, msg.Scope, err.Error())
		return
	}

	sub, err := s.adapter.Subscribe(msg.Domain, normalized)
	if err != nil {
		s.sendError(msg.Domain, msg.Scope, err.Error())
		return
	}

	key := subscriptionKey(msg.Domain, normalized)
	s.storeSubscription(key, sub)

	if s.sendReset {
		s.enqueue(ServerMessage{
			Type:        MessageTypeReset,
			Domain:      msg.Domain,
			Scope:       normalized,
			ClusterID:   s.clusterID,
			ClusterName: s.clusterName,
		})
	}

	go s.forwardSubscription(sub)
}

func (s *session) handleCancel(msg ClientMessage) {
	if msg.Domain == "" {
		s.sendError(msg.Domain, msg.Scope, "domain is required")
		return
	}

	_, trimmed := refresh.SplitClusterScope(msg.Scope)
	normalized, err := s.adapter.NormalizeScope(msg.Domain, trimmed)
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
			s.enqueue(update)
		case reason, ok := <-sub.Drops:
			if !ok {
				return
			}
			s.enqueue(ServerMessage{
				Type:        MessageTypeComplete,
				Domain:      sub.Domain,
				Scope:       sub.Scope,
				ClusterID:   s.clusterID,
				ClusterName: s.clusterName,
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
		s.logger.Warn("stream mux: outgoing buffer full, closing connection", "StreamMux")
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
				ClusterID:   s.clusterID,
				ClusterName: s.clusterName,
			}); err != nil {
				return
			}
		}
	}
}

func (s *session) writeMessage(msg ServerMessage) error {
	if err := s.conn.SetWriteDeadline(time.Now().Add(writeTimeout)); err != nil {
		s.logger.Warn(fmt.Sprintf("stream mux: write deadline failed: %v", err), "StreamMux")
	}
	if err := s.conn.WriteJSON(msg); err != nil {
		s.logger.Warn(fmt.Sprintf("stream mux write error: %v", err), "StreamMux")
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
		ClusterID:   s.clusterID,
		ClusterName: s.clusterName,
		Error:       message,
	}
	s.enqueue(msg)
}

func subscriptionKey(domain, scope string) string {
	return strings.TrimSpace(domain) + "|" + strings.TrimSpace(scope)
}
