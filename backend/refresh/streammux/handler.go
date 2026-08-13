package streammux

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"time"

	apierrors "k8s.io/apimachinery/pkg/api/errors"

	"github.com/luxury-yacht/app/backend/internal/applog"
	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/internal/logsources"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/containerlogsstream"
	"github.com/luxury-yacht/app/backend/refresh/telemetry"
)

// Conn is the transport-neutral JSON stream used by the multiplexer. Wails'
// StreamConn implements this interface directly.
type Conn interface {
	ReceiveJSON(v interface{}) error
	SendJSON(v interface{}) error
	Close() error
}

// Selector is the typed subscription identity produced by an adapter after the
// stream boundary resolves cluster routing and strips transport-only cluster
// prefixes from the scope string.
type Selector interface {
	Cluster() string
	DomainName() string
	CanonicalScope() string
}

// Adapter provides domain-specific selector parsing and subscription logic.
type Adapter interface {
	ParseSelector(clusterID, domain, scope string) (Selector, error)
	Subscribe(selector Selector) (*Subscription, error)
	Resume(selector Selector, since uint64) ([]ServerMessage, bool)
}

// Config captures the dependencies for a named stream multiplexer.
type Config struct {
	Adapter                    Adapter
	Logger                     containerlogsstream.Logger
	Telemetry                  *telemetry.Recorder
	ClusterID                  string
	ClusterName                string
	StreamName                 string
	SendReset                  bool
	AllowClusterScopedRequests bool
	ResolveClusterName         func(clusterID string) string
}

// Handler multiplexes subscriptions over a named Wails stream.
type Handler struct {
	adapter                    Adapter
	logger                     containerlogsstream.Logger
	telemetry                  *telemetry.Recorder
	clusterID                  string
	clusterName                string
	streamName                 string
	sendReset                  bool
	allowClusterScopedRequests bool
	resolveClusterName         func(clusterID string) string
	sessionsMu                 sync.Mutex
	sessions                   map[*session]struct{}
	stopped                    bool
}

// NewHandler constructs a named-stream multiplexer handler.
func NewHandler(cfg Config) (*Handler, error) {
	if cfg.Adapter == nil {
		return nil, errors.New("stream adapter is required")
	}
	if cfg.Logger == nil {
		cfg.Logger = applog.Noop
	}
	cfg.Logger = applog.ClusterScoped(cfg.Logger, cfg.ClusterID, cfg.ClusterName)
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
		sessions:                   make(map[*session]struct{}),
	}, nil
}

// Handle serves one Wails named-stream connection until the peer closes it.
func (h *Handler) Handle(conn Conn, ctx context.Context) {
	h.sessionsMu.Lock()
	if h.stopped {
		h.sessionsMu.Unlock()
		_ = conn.Close()
		return
	}

	session := newSession(
		conn, Config{Adapter: h.adapter, Logger: h.logger, Telemetry: h.telemetry, ClusterID: h.clusterID, ClusterName: h.clusterName, StreamName: h.streamName, SendReset: h.sendReset, AllowClusterScopedRequests: h.allowClusterScopedRequests, ResolveClusterName: h.resolveClusterName})
	h.sessions[session] = struct{}{}
	h.sessionsMu.Unlock()

	if h.telemetry != nil {
		h.telemetry.RecordStreamConnect(h.streamName)
		defer h.telemetry.RecordStreamDisconnect(h.streamName)
	}
	defer func() {
		h.sessionsMu.Lock()
		delete(h.sessions, session)
		h.sessionsMu.Unlock()
	}()
	session.run(ctx)
}

// Stop closes every active session and makes this handler generation terminal.
func (h *Handler) Stop() {
	if h == nil {
		return
	}
	h.sessionsMu.Lock()
	h.stopped = true
	sessions := make([]*session, 0, len(h.sessions))
	for active := range h.sessions {
		sessions = append(sessions, active)
	}
	h.sessionsMu.Unlock()
	for _, active := range sessions {
		active.shutdown()
	}
}

// InvalidateClusterSubscriptions ends every active subscription for one
// cluster. Each session emits COMPLETE for the ended scopes, causing clients to
// subscribe again through the adapter's current topology.
func (h *Handler) InvalidateClusterSubscriptions(clusterID string) {
	if h == nil || strings.TrimSpace(clusterID) == "" {
		return
	}
	h.sessionsMu.Lock()
	sessions := make([]*session, 0, len(h.sessions))
	for active := range h.sessions {
		sessions = append(sessions, active)
	}
	h.sessionsMu.Unlock()

	for _, active := range sessions {
		active.invalidateClusterSubscriptions(clusterID)
	}
}

type session struct {
	conn                      Conn
	adapter                   Adapter
	logger                    containerlogsstream.Logger
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

	signalVersionCounter uint64
}

type sessionSubscription struct {
	sub         *Subscription
	clusterID   string
	clusterName string
}

func newSession(conn Conn, cfg Config) *session {
	return &session{
		conn:                      conn,
		adapter:                   cfg.Adapter,
		logger:                    cfg.Logger,
		telemetry:                 cfg.Telemetry,
		clusterID:                 cfg.ClusterID,
		clusterName:               cfg.ClusterName,
		streamName:                cfg.StreamName,
		sendReset:                 cfg.SendReset,
		allowClusterScopedRequest: cfg.AllowClusterScopedRequests,
		resolveClusterName:        cfg.ResolveClusterName,
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

func (s *session) invalidateClusterSubscriptions(clusterID string) {
	s.mu.Lock()
	subscriptions := make([]*Subscription, 0)
	for _, entry := range s.subs {
		if entry.clusterID == clusterID {
			subscriptions = append(subscriptions, entry.sub)
		}
	}
	s.mu.Unlock()

	for _, sub := range subscriptions {
		sub.Cancel()
	}
}

func (s *session) readLoop() {
	for {
		var msg ClientMessage
		if err := s.conn.ReceiveJSON(&msg); err != nil {
			if ctxErr := s.doneError(); ctxErr == nil {
				s.logger.Debug(fmt.Sprintf("stream mux connection closed: %v", err), logsources.StreamMux)
			}
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

func (s *session) doneError() error {
	select {
	case <-s.done:
		return context.Canceled
	default:
		return nil
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
	selector, err := s.adapter.ParseSelector(clusterID, msg.Domain, trimmed)
	if err != nil {
		s.sendError(clusterID, msg.Domain, msg.Scope, err)
		return
	}
	normalized := selector.CanonicalScope()

	sub, err := s.adapter.Subscribe(selector)
	if err != nil {
		s.sendError(clusterID, msg.Domain, msg.Scope, err)
		return
	}

	key := subscriptionKey(selector)
	s.storeSubscription(key, sub, clusterID, clusterName)
	s.enqueueSubscriptionAck(msg.Domain, normalized, clusterID, clusterName)
	resume := s.resumeSubscription(selector, msg.ResumeToken, msg.Domain, normalized)
	s.enqueueSubscriptionReset(msg.Domain, normalized, clusterID, clusterName, resume.ok)
	s.enqueueResumeUpdates(resume.updates, clusterID, clusterName)
	go s.forwardSubscription(key, resume.highWater)
}

func (s *session) enqueueSubscriptionAck(domain, scope, clusterID, clusterName string) {
	// Positively confirm EVERY accepted subscribe. The client anchors its
	// "synchronized" stream health on this frame; without it, a resumed
	// subscribe with no buffered updates is indistinguishable from an ignored
	// one, and the client would either poll a healthy stream forever or trust
	// a dead one. Clients that predate ACK drop the frame at parse.
	s.enqueue(ServerMessage{
		Type:        MessageTypeAck,
		Domain:      domain,
		Scope:       scope,
		ClusterID:   clusterID,
		ClusterName: clusterName,
	})
}

type subscriptionResume struct {
	updates   []ServerMessage
	ok        bool
	highWater uint64
}

func (s *session) resumeSubscription(selector Selector, token, domain, scope string) subscriptionResume {
	resumeToken := parseResumeToken(token)
	result := subscriptionResume{}
	if resumeToken > 0 {
		result.updates, result.ok = s.adapter.Resume(selector, resumeToken)
		if !result.ok {
			s.logger.Warn(fmt.Sprintf("stream mux: resume token expired for %s/%s", domain, scope), logsources.StreamMux)
		}
		if result.ok && len(result.updates) > 0 {
			// Track the highest buffered sequence to skip duplicates from live delivery.
			result.highWater = resumeToken
			for _, update := range result.updates {
				if sequence, ok := parseSequence(update.Sequence); ok && sequence > result.highWater {
					result.highWater = sequence
				}
			}
		}
	}
	return result
}

func (s *session) enqueueSubscriptionReset(domain, scope, clusterID, clusterName string, resumeOK bool) {
	if s.sendReset && !resumeOK {
		s.enqueue(ServerMessage{
			Type:        MessageTypeReset,
			Domain:      domain,
			Scope:       scope,
			ClusterID:   clusterID,
			ClusterName: clusterName,
		})
	}
}

func (s *session) enqueueResumeUpdates(updates []ServerMessage, clusterID, clusterName string) {
	for _, update := range updates {
		s.enqueue(s.withClusterInfo(update, clusterID, clusterName))
	}
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
	selector, err := s.adapter.ParseSelector(clusterID, msg.Domain, trimmed)
	if err != nil {
		s.sendError(clusterID, msg.Domain, msg.Scope, err)
		return
	}

	key := subscriptionKey(selector)
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
	msg = s.prepareOutgoingMessage(msg)
	select {
	case s.outgoing <- msg:
	default:
		s.handleBackpressure(msg)
	}
}

func (s *session) prepareOutgoingMessage(msg ServerMessage) ServerMessage {
	msg = withSignalEnvelope(msg)
	if strings.TrimSpace(msg.Version) == "" && msg.Source != "" && msg.Signal != "" {
		msg.Version = s.nextSignalVersion(msg.Source)
	}
	return msg
}

func (s *session) nextSignalVersion(source Source) string {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.signalVersionCounter++
	return fmt.Sprintf("%s:%d", source, s.signalVersionCounter)
}

func (s *session) handleBackpressure(msg ServerMessage) {
	if msg.Type == MessageTypeHeartbeat {
		s.logger.Warn("stream mux: outgoing buffer full, dropping heartbeat", logsources.StreamMux, s.clusterID, s.clusterName)
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
		s.logger.Warn("stream mux: outgoing buffer full, dropping message", logsources.StreamMux, s.clusterID, s.clusterName)
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
	reset = s.prepareOutgoingMessage(reset)
	select {
	case s.outgoing <- reset:
		s.logger.Warn(fmt.Sprintf("stream mux: outgoing buffer full, issued reset for %s/%s", msg.Domain, msg.Scope), logsources.StreamMux, clusterID, clusterName)
	default:
		s.logger.Warn("stream mux: outgoing buffer full, dropping message", logsources.StreamMux, clusterID, clusterName)
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
	// Populate the public {source, signal} doorbell pair from the internal
	// MessageType at the one send chokepoint, so live and resume-replayed frames
	// carry it identically.
	msg = s.prepareOutgoingMessage(msg)
	if err := s.conn.SendJSON(msg); err != nil {
		s.logger.Debug(fmt.Sprintf("stream mux connection closed while sending: %v", err), logsources.StreamMux)
		s.shutdown()
		return err
	}
	return nil
}

// resolveClusterID determines the cluster to use for the incoming message.
func (s *session) resolveClusterID(msg ClientMessage) (string, error) {
	scopeClusterIDs, _ := refresh.SplitClusterScopeList(msg.Scope)
	if len(scopeClusterIDs) > 1 {
		return "", errors.New("stream scope must target a single cluster")
	}
	scopeClusterID := ""
	if len(scopeClusterIDs) == 1 {
		scopeClusterID = scopeClusterIDs[0]
	}

	if !s.allowClusterScopedRequest {
		if msg.ClusterID != "" && msg.ClusterID != s.clusterID {
			return "", errors.New("cluster mismatch")
		}
		if scopeClusterID != "" && scopeClusterID != s.clusterID {
			return "", errors.New("cluster mismatch")
		}
		return s.clusterID, nil
	}
	clusterID := strings.TrimSpace(msg.ClusterID)
	if clusterID == "" {
		clusterID = scopeClusterID
	}
	if clusterID == "" {
		return "", errors.New("cluster id is required")
	}
	if scopeClusterID != "" && scopeClusterID != clusterID {
		return "", errors.New("cluster mismatch")
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

func subscriptionKey(selector Selector) string {
	return strings.TrimSpace(selector.Cluster()) + "|" + strings.TrimSpace(selector.DomainName()) + "|" + strings.TrimSpace(selector.CanonicalScope())
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
