package streammux

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	apierrors "k8s.io/apimachinery/pkg/api/errors"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/logstream"
	"github.com/luxury-yacht/app/backend/refresh/telemetry"
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
	Resume(domain, scope string, since uint64) ([]ServerMessage, bool)
}

// ClusterAdapter allows multiplexing subscriptions across clusters.
type ClusterAdapter interface {
	Adapter
	SubscribeCluster(clusterID, domain, scope string) (*Subscription, error)
	ResumeCluster(clusterID, domain, scope string, since uint64) ([]ServerMessage, bool)
}

// Config captures the dependencies for a websocket stream multiplexer.
type Config struct {
	Adapter                    Adapter
	Logger                     logstream.Logger
	Telemetry                  *telemetry.Recorder
	ClusterID                  string
	ClusterName                string
	StreamName                 string
	SendReset                  bool
	AllowClusterScopedRequests bool
	ResolveClusterName         func(clusterID string) string
}

// Handler exposes a websocket endpoint that multiplexes stream subscriptions.
type Handler struct {
	adapter                    Adapter
	logger                     logstream.Logger
	telemetry                  *telemetry.Recorder
	clusterID                  string
	clusterName                string
	streamName                 string
	sendReset                  bool
	allowClusterScopedRequests bool
	resolveClusterName         func(clusterID string) string
	upgrader                   websocket.Upgrader
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
		adapter:                    cfg.Adapter,
		logger:                     cfg.Logger,
		telemetry:                  cfg.Telemetry,
		clusterID:                  cfg.ClusterID,
		clusterName:                cfg.ClusterName,
		streamName:                 cfg.StreamName,
		sendReset:                  cfg.SendReset,
		allowClusterScopedRequests: cfg.AllowClusterScopedRequests,
		resolveClusterName:         cfg.ResolveClusterName,
		upgrader: websocket.Upgrader{
			ReadBufferSize:  config.StreamMuxReadBufferSize,
			WriteBufferSize: config.StreamMuxWriteBufferSize,
			// Prevent slow or stalled websocket upgrades from hanging indefinitely.
			HandshakeTimeout: config.StreamMuxHandshakeTimeout,
			CheckOrigin:      func(r *http.Request) bool { return true },
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

	session := newSession(
		conn,
		h.adapter,
		h.logger,
		h.telemetry,
		h.clusterID,
		h.clusterName,
		h.streamName,
		h.sendReset,
		h.allowClusterScopedRequests,
		h.resolveClusterName,
	)
	session.run(r.Context())
}

type session struct {
	conn                      wsConn
	adapter                   Adapter
	logger                    logstream.Logger
	telemetry                 *telemetry.Recorder
	clusterID                 string
	clusterName               string
	streamName                string
	sendReset                 bool
	allowClusterScopedRequest bool
	resolveClusterName        func(clusterID string) string

	mu        sync.Mutex
	subs      map[string]*sessionSubscription
	outgoing  chan ServerMessage
	done      chan struct{}
	closeOnce sync.Once
}

type sessionSubscription struct {
	sub         *Subscription
	clusterID   string
	clusterName string
}

// Normal view transitions close the websocket without a close status or after we send a close.
func isExpectedStreamCloseError(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, websocket.ErrCloseSent) {
		return true
	}
	return websocket.IsCloseError(
		err,
		websocket.CloseNormalClosure,
		websocket.CloseGoingAway,
		websocket.CloseNoStatusReceived,
	)
}

func newSession(
	conn wsConn,
	adapter Adapter,
	logger logstream.Logger,
	recorder *telemetry.Recorder,
	clusterID, clusterName, streamName string,
	sendReset bool,
	allowClusterScopedRequest bool,
	resolveClusterName func(clusterID string) string,
) *session {
	return &session{
		conn:                      conn,
		adapter:                   adapter,
		logger:                    logger,
		telemetry:                 recorder,
		clusterID:                 clusterID,
		clusterName:               clusterName,
		streamName:                streamName,
		sendReset:                 sendReset,
		allowClusterScopedRequest: allowClusterScopedRequest,
		resolveClusterName:        resolveClusterName,
		subs:                      make(map[string]*sessionSubscription),
		outgoing:                  make(chan ServerMessage, config.StreamMuxOutgoingBufferSize),
		done:                      make(chan struct{}),
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
			sub.sub.Cancel()
		}
		s.subs = make(map[string]*sessionSubscription)
		s.mu.Unlock()
		_ = s.conn.Close()
	})
}

func (s *session) readLoop() {
	for {
		var msg ClientMessage
		if err := s.conn.ReadJSON(&msg); err != nil {
			if !websocket.IsUnexpectedCloseError(
				err,
				websocket.CloseNormalClosure,
				websocket.CloseGoingAway,
				websocket.CloseNoStatusReceived,
			) {
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
			s.sendError(msg.ClusterID, msg.Domain, msg.Scope, errors.New("unsupported request type"))
		}
	}
}

func (s *session) handleSubscribe(msg ClientMessage) {
	if msg.Domain == "" {
		s.sendError(msg.ClusterID, msg.Domain, msg.Scope, errors.New("domain is required"))
		return
	}
	clusterID, err := s.resolveClusterID(msg)
	if err != nil {
		s.sendError(msg.ClusterID, msg.Domain, msg.Scope, err)
		return
	}
	clusterName := s.clusterNameFor(clusterID)

	_, trimmed := refresh.SplitClusterScope(msg.Scope)
	normalized, err := s.adapter.NormalizeScope(msg.Domain, trimmed)
	if err != nil {
		s.sendError(clusterID, msg.Domain, msg.Scope, err)
		return
	}

	sub, err := s.subscribe(clusterID, msg.Domain, normalized)
	if err != nil {
		s.sendError(clusterID, msg.Domain, msg.Scope, err)
		return
	}

	key := subscriptionKey(clusterID, msg.Domain, normalized)
	s.storeSubscription(key, sub, clusterID, clusterName)

	resumeToken := parseResumeToken(msg.ResumeToken)
	resumeUpdates := []ServerMessage(nil)
	resumeOK := false
	resumeHighWater := uint64(0)
	if resumeToken > 0 {
		resumeUpdates, resumeOK = s.resume(clusterID, msg.Domain, normalized, resumeToken)
		if !resumeOK {
			s.logger.Warn(fmt.Sprintf("stream mux: resume token expired for %s/%s", msg.Domain, normalized), "StreamMux")
		}
		if resumeOK && len(resumeUpdates) > 0 {
			// Track the highest buffered sequence to skip duplicates from live delivery.
			resumeHighWater = resumeToken
			for _, update := range resumeUpdates {
				if sequence, ok := parseSequence(update.Sequence); ok && sequence > resumeHighWater {
					resumeHighWater = sequence
				}
			}
		}
	}

	if s.sendReset && !resumeOK {
		s.enqueue(ServerMessage{
			Type:        MessageTypeReset,
			Domain:      msg.Domain,
			Scope:       normalized,
			ClusterID:   clusterID,
			ClusterName: clusterName,
		})
	}

	if resumeOK && len(resumeUpdates) > 0 {
		for _, update := range resumeUpdates {
			s.enqueue(s.withClusterInfo(update, clusterID, clusterName))
		}
	}

	go s.forwardSubscription(key, resumeHighWater)
}

func (s *session) handleCancel(msg ClientMessage) {
	if msg.Domain == "" {
		s.sendError(msg.ClusterID, msg.Domain, msg.Scope, errors.New("domain is required"))
		return
	}
	clusterID, err := s.resolveClusterID(msg)
	if err != nil {
		s.sendError(msg.ClusterID, msg.Domain, msg.Scope, err)
		return
	}

	_, trimmed := refresh.SplitClusterScope(msg.Scope)
	normalized, err := s.adapter.NormalizeScope(msg.Domain, trimmed)
	if err != nil {
		s.sendError(clusterID, msg.Domain, msg.Scope, err)
		return
	}

	key := subscriptionKey(clusterID, msg.Domain, normalized)
	s.mu.Lock()
	sub := s.subs[key]
	delete(s.subs, key)
	s.mu.Unlock()
	if sub == nil {
		return
	}
	sub.sub.Cancel()
}

func (s *session) storeSubscription(key string, sub *Subscription, clusterID, clusterName string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if existing := s.subs[key]; existing != nil {
		existing.sub.Cancel()
	}
	s.subs[key] = &sessionSubscription{
		sub:         sub,
		clusterID:   clusterID,
		clusterName: clusterName,
	}
}

func (s *session) forwardSubscription(key string, resumeHighWater uint64) {
	s.mu.Lock()
	entry := s.subs[key]
	s.mu.Unlock()
	if entry == nil {
		return
	}
	for {
		select {
		case update, ok := <-entry.sub.Updates:
			if !ok {
				return
			}
			if resumeHighWater > 0 {
				// Skip updates already replayed from the resume buffer.
				if sequence, ok := parseSequence(update.Sequence); ok && sequence <= resumeHighWater {
					continue
				}
			}
			s.enqueue(s.withClusterInfo(update, entry.clusterID, entry.clusterName))
		case reason, ok := <-entry.sub.Drops:
			if !ok {
				return
			}
			s.enqueue(ServerMessage{
				Type:        MessageTypeComplete,
				Domain:      entry.sub.Domain,
				Scope:       entry.sub.Scope,
				ClusterID:   entry.clusterID,
				ClusterName: entry.clusterName,
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
		s.handleBackpressure(msg)
	}
}

func (s *session) handleBackpressure(msg ServerMessage) {
	if msg.Type == MessageTypeHeartbeat {
		s.logger.Warn("stream mux: outgoing buffer full, dropping heartbeat", "StreamMux")
		return
	}

	// Drop the oldest message and issue a RESET so only the hot scope resyncs.
	select {
	case <-s.outgoing:
	default:
	}
	if s.telemetry != nil {
		s.telemetry.RecordStreamDelivery(s.streamName, 0, 1)
	}

	if msg.Domain == "" || msg.Scope == "" {
		s.logger.Warn("stream mux: outgoing buffer full, dropping message", "StreamMux")
		return
	}

	clusterID := strings.TrimSpace(msg.ClusterID)
	if clusterID == "" {
		clusterID = s.clusterID
	}
	clusterName := msg.ClusterName
	if clusterName == "" {
		clusterName = s.clusterNameFor(clusterID)
	}
	reset := ServerMessage{
		Type:        MessageTypeReset,
		Domain:      msg.Domain,
		Scope:       msg.Scope,
		ClusterID:   clusterID,
		ClusterName: clusterName,
	}
	select {
	case s.outgoing <- reset:
		s.logger.Warn(fmt.Sprintf("stream mux: outgoing buffer full, issued reset for %s/%s", msg.Domain, msg.Scope), "StreamMux")
	default:
		s.logger.Warn("stream mux: outgoing buffer full, dropping message", "StreamMux")
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
	if err := s.conn.SetWriteDeadline(time.Now().Add(config.StreamMuxWriteTimeout)); err != nil {
		s.logger.Warn(fmt.Sprintf("stream mux: write deadline failed: %v", err), "StreamMux")
	}
	if err := s.conn.WriteJSON(msg); err != nil {
		if !isExpectedStreamCloseError(err) {
			s.logger.Warn(fmt.Sprintf("stream mux write error: %v", err), "StreamMux")
		}
		s.shutdown()
		return err
	}
	return nil
}

// resolveClusterID determines the cluster to use for the incoming message.
func (s *session) resolveClusterID(msg ClientMessage) (string, error) {
	if !s.allowClusterScopedRequest {
		if msg.ClusterID != "" && msg.ClusterID != s.clusterID {
			return "", errors.New("cluster mismatch")
		}
		return s.clusterID, nil
	}
	clusterID := strings.TrimSpace(msg.ClusterID)
	if clusterID == "" {
		clusterIDs, _ := refresh.SplitClusterScopeList(msg.Scope)
		if len(clusterIDs) == 1 {
			clusterID = clusterIDs[0]
		}
	}
	if clusterID == "" {
		return "", errors.New("cluster id is required")
	}
	return clusterID, nil
}

// clusterNameFor resolves a display name for the given cluster ID.
func (s *session) clusterNameFor(clusterID string) string {
	if clusterID == "" {
		return s.clusterName
	}
	if s.resolveClusterName != nil {
		if resolved := s.resolveClusterName(clusterID); resolved != "" {
			return resolved
		}
	}
	if clusterID == s.clusterID {
		return s.clusterName
	}
	return ""
}

// withClusterInfo ensures the outgoing message includes cluster metadata.
func (s *session) withClusterInfo(msg ServerMessage, clusterID, clusterName string) ServerMessage {
	if msg.ClusterID == "" {
		msg.ClusterID = clusterID
	}
	if msg.ClusterName == "" && clusterName != "" {
		msg.ClusterName = clusterName
	}
	return msg
}

// subscribe routes subscriptions through a cluster-aware adapter when configured.
func (s *session) subscribe(clusterID, domain, scope string) (*Subscription, error) {
	if s.allowClusterScopedRequest {
		adapter, ok := s.adapter.(ClusterAdapter)
		if !ok {
			return nil, errors.New("cluster-scoped subscriptions are not supported")
		}
		return adapter.SubscribeCluster(clusterID, domain, scope)
	}
	return s.adapter.Subscribe(domain, scope)
}

// resume routes resume buffers through a cluster-aware adapter when configured.
func (s *session) resume(clusterID, domain, scope string, since uint64) ([]ServerMessage, bool) {
	if s.allowClusterScopedRequest {
		adapter, ok := s.adapter.(ClusterAdapter)
		if !ok {
			return nil, false
		}
		return adapter.ResumeCluster(clusterID, domain, scope, since)
	}
	return s.adapter.Resume(domain, scope, since)
}

func (s *session) sendError(clusterID, domain, scope string, err error) {
	if err == nil {
		err = errors.New("stream error")
	}
	resolvedClusterID := strings.TrimSpace(clusterID)
	if resolvedClusterID == "" {
		resolvedClusterID = s.clusterID
	}
	clusterName := s.clusterNameFor(resolvedClusterID)
	msg := ServerMessage{
		Type:        MessageTypeError,
		Domain:      domain,
		Scope:       scope,
		ClusterID:   resolvedClusterID,
		ClusterName: clusterName,
		Error:       err.Error(),
	}
	if status, ok := refresh.PermissionDeniedStatusFromError(err); ok {
		msg.ErrorDetails = status
	} else if apierrors.IsForbidden(err) {
		wrapped := refresh.WrapPermissionDenied(err, domain, "")
		if status, ok := refresh.PermissionDeniedStatusFromError(wrapped); ok {
			msg.ErrorDetails = status
		}
	}
	s.enqueue(msg)
}

func subscriptionKey(clusterID, domain, scope string) string {
	return strings.TrimSpace(clusterID) + "|" + strings.TrimSpace(domain) + "|" + strings.TrimSpace(scope)
}

// parseResumeToken converts client tokens into sequence numbers, defaulting to zero on errors.
func parseResumeToken(value string) uint64 {
	token, ok := parseSequence(value)
	if !ok {
		return 0
	}
	return token
}

// parseSequence parses a stream sequence, returning false for empty or invalid input.
func parseSequence(value string) (uint64, bool) {
	if value == "" {
		return 0, false
	}
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return 0, false
	}
	token, err := strconv.ParseUint(trimmed, 10, 64)
	if err != nil {
		return 0, false
	}
	return token, true
}
