package eventstream

import (
	"context"
	"fmt"
	"sync"
	"sync/atomic"
	"time"

	corev1 "k8s.io/api/core/v1"
	coreinformers "k8s.io/client-go/informers/core/v1"
	"k8s.io/client-go/tools/cache"

	"github.com/luxury-yacht/app/backend/internal/applog"
	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/internal/logsources"
	"github.com/luxury-yacht/app/backend/internal/timeutil"
	"github.com/luxury-yacht/app/backend/refresh/ringbuffer"
	"github.com/luxury-yacht/app/backend/refresh/telemetry"
	eventres "github.com/luxury-yacht/app/backend/resources/events"
)

// Manager fan-outs informer updates to subscribed streaming clients.
type Manager struct {
	informer  coreinformers.EventInformer
	clusterID string
	logger    Logger

	mu             sync.RWMutex
	subscribers    map[string]map[uint64]*subscription
	buffers        map[string]*eventBuffer
	sequences      map[string]uint64
	nextID         uint64
	telemetry      *telemetry.Recorder
	signalObserver func(scope string, sequence uint64)
}

type bufferedEvent struct {
	sequence uint64
	entry    Entry
}

// eventBuffer is the per-scope resume buffer; the ring + replay logic is shared
// via ringbuffer.Buffer.
type eventBuffer = ringbuffer.Buffer[bufferedEvent]

func newEventBuffer(max int) *eventBuffer {
	return ringbuffer.New(max, func(e bufferedEvent) uint64 { return e.sequence })
}

// NewManager wires the event informer into a streaming manager.
func NewManager(
	informer coreinformers.EventInformer,
	logger Logger,
	recorder *telemetry.Recorder,
	clusterID string,
) *Manager {
	if logger == nil {
		logger = applog.Noop
	}
	m := &Manager{
		informer:    informer,
		clusterID:   clusterID,
		logger:      logger,
		subscribers: make(map[string]map[uint64]*subscription),
		buffers:     make(map[string]*eventBuffer),
		sequences:   make(map[string]uint64),
		telemetry:   recorder,
	}

	informer.Informer().AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc:    m.handleEvent,
		UpdateFunc: func(_, newObj interface{}) { m.handleEvent(newObj) },
	})

	return m
}

func (m *Manager) SetSignalObserver(observer func(scope string, sequence uint64)) {
	if m == nil {
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.signalObserver = observer
}

// Subscribe returns a channel that receives events for the provided scope.
// Supported scopes: "cluster" for cluster-wide events, or "namespace:<name>" for namespace events.
// Returns nil channel and no-op cancel if subscriber limit is reached for the scope.
func (m *Manager) Subscribe(scope string) (<-chan StreamEvent, context.CancelFunc) {
	if scope == "" {
		scope = "cluster"
	}

	m.mu.Lock()
	id, sub, ok := m.addSubscriberLocked(scope)
	m.mu.Unlock()
	if !ok {
		return nil, func() {}
	}

	return sub.ch, func() { m.dropSubscriber(scope, id, sub) }
}

// SubscribeWithResume registers a subscriber and returns buffered events after `since` in one lock scope.
// This avoids gaps between resume checks and subscription registration.
func (m *Manager) SubscribeWithResume(
	scope string,
	since uint64,
) ([]StreamEvent, <-chan StreamEvent, context.CancelFunc, bool, bool) {
	if scope == "" {
		scope = "cluster"
	}
	if since == 0 {
		ch, cancel := m.Subscribe(scope)
		if ch == nil {
			return nil, nil, func() {}, false, true
		}
		return nil, ch, cancel, true, false
	}

	m.mu.Lock()
	buffer := m.buffers[scope]
	if buffer == nil {
		m.mu.Unlock()
		return nil, nil, nil, false, false
	}
	items, ok := buffer.Since(since)
	if !ok {
		m.mu.Unlock()
		return nil, nil, nil, false, false
	}
	id, sub, limitOK := m.addSubscriberLocked(scope)
	m.mu.Unlock()
	if !limitOK {
		return nil, nil, func() {}, false, true
	}

	events := make([]StreamEvent, 0, len(items))
	for _, item := range items {
		events = append(events, StreamEvent{
			Entry:    item.entry,
			Sequence: item.sequence,
		})
	}

	return events, sub.ch, func() { m.dropSubscriber(scope, id, sub) }, true, false
}

// Resume returns buffered events after the provided sequence for the scope.
// Returns ok=false when the buffer cannot satisfy the resume token.
func (m *Manager) Resume(scope string, since uint64) ([]StreamEvent, bool) {
	if since == 0 {
		return nil, false
	}
	m.mu.RLock()
	buffer := m.buffers[scope]
	if buffer == nil {
		m.mu.RUnlock()
		return nil, false
	}
	items, ok := buffer.Since(since)
	m.mu.RUnlock()
	if !ok {
		return nil, false
	}
	events := make([]StreamEvent, 0, len(items))
	for _, item := range items {
		events = append(events, StreamEvent{
			Entry:    item.entry,
			Sequence: item.sequence,
		})
	}
	return events, true
}

func (m *Manager) logWarn(message string) {
	if m == nil {
		return
	}
	applog.Warn(m.logger, message, logsources.EventStream, m.clusterID)
}

// NextSequence reserves a sequence for non-event payloads (for example, initial snapshots).
func (m *Manager) NextSequence(scope string) uint64 {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.nextSequenceLocked(scope)
}

// addSubscriberLocked appends a subscriber entry while enforcing per-scope limits.
func (m *Manager) addSubscriberLocked(scope string) (uint64, *subscription, bool) {
	if _, ok := m.subscribers[scope]; !ok {
		m.subscribers[scope] = make(map[uint64]*subscription)
	}

	// Check subscriber limit before adding.
	if len(m.subscribers[scope]) >= config.EventStreamMaxSubscribersPerScope {
		m.logWarn(fmt.Sprintf(
			"eventstream: subscriber limit (%d) reached for scope %s",
			config.EventStreamMaxSubscribersPerScope,
			scope,
		))
		if m.telemetry != nil {
			m.telemetry.RecordStreamError(
				telemetry.StreamEvents,
				fmt.Errorf("subscriber limit reached for scope %s", scope),
			)
		}
		return 0, nil, false
	}

	ch := make(chan StreamEvent, config.EventStreamSubscriberBufferSize)
	id := atomic.AddUint64(&m.nextID, 1)
	sub := &subscription{ch: ch, created: time.Now()}
	m.subscribers[scope][id] = sub
	return id, sub, true
}

func (m *Manager) handleEvent(obj interface{}) {
	evt, ok := obj.(*corev1.Event)
	if !ok || evt == nil {
		return
	}

	facts := eventres.BuildFacts(m.clusterID, evt)
	entry := Entry{
		ClusterID:        m.clusterID,
		Kind:             evt.InvolvedObject.Kind,
		Name:             evt.Name,
		UID:              string(evt.UID),
		ResourceVersion:  evt.ResourceVersion,
		Namespace:        evt.InvolvedObject.Namespace,
		ObjectNamespace:  evt.InvolvedObject.Namespace,
		ObjectUID:        string(evt.InvolvedObject.UID),
		ObjectAPIVersion: evt.InvolvedObject.APIVersion,
		InvolvedObject:   facts.InvolvedObject,
		Type:             facts.EventType,
		Source:           facts.Source,
		Reason:           facts.Reason,
		Object:           eventres.EventObjectDisplay(evt),
		Message:          facts.Message,
	}

	lastSeen := timeutil.LatestEventTimestamp(evt)
	if lastSeen.IsZero() {
		lastSeen = time.Now()
	}
	entry.CreatedAt = lastSeen.UnixMilli()
	entry.Age = timeutil.FormatAge(lastSeen)

	if entry.ObjectNamespace == "" {
		m.broadcast("cluster", entry)
	}
	if entry.ObjectNamespace != "" {
		m.broadcast("namespace:"+entry.ObjectNamespace, entry)
	}
}

func (m *Manager) broadcast(scope string, entry Entry) {
	m.mu.Lock()
	subscribers := m.subscribers[scope]
	buffer := m.buffers[scope]
	observer := m.signalObserver
	// Only keep resume buffers when active or recent subscribers exist.
	shouldBuffer := len(subscribers) > 0 || buffer != nil
	var sequence uint64
	if shouldBuffer || observer != nil {
		sequence = m.nextSequenceLocked(scope)
	}
	if shouldBuffer {
		if buffer == nil {
			buffer = newEventBuffer(config.EventStreamResumeBufferSize)
			m.buffers[scope] = buffer
		}
		buffer.Add(bufferedEvent{sequence: sequence, entry: entry})
	}
	items := make([]struct {
		id  uint64
		sub *subscription
	}, 0, len(subscribers))
	for id, sub := range subscribers {
		items = append(items, struct {
			id  uint64
			sub *subscription
		}{id: id, sub: sub})
	}
	m.mu.Unlock()
	if observer != nil && sequence > 0 {
		observer(scope, sequence)
	}
	if len(items) == 0 {
		return
	}
	streamEvent := StreamEvent{Entry: entry, Sequence: sequence}

	delivered := 0
	backlogDrops := 0
	closedCount := 0
	for _, item := range items {
		sub := item.sub
		sent, closed, dropped := m.trySend(sub, streamEvent)
		if closed {
			closedCount++
			go m.dropSubscriber(scope, item.id, sub)
			continue
		}
		if sent {
			delivered++
			if dropped {
				backlogDrops++
			}
			continue
		}
		m.logWarn("eventstream: subscriber channel full after drop attempt; closing")
		go m.dropSubscriber(scope, item.id, sub)
	}
	m.recordDelivery(scope, delivered, backlogDrops)
}

// recordDelivery attributes delivery/backlog to the event scope (the diagnostics
// child): "cluster" for cluster-wide events or "namespace:<name>" for a namespace.
// Sessions/connect stay stream-level (one socket per scope, counted at the stream).
func (m *Manager) recordDelivery(scope string, delivered, backlogDrops int) {
	if m.telemetry == nil {
		return
	}
	m.telemetry.RecordStreamDeliveryForDomain(telemetry.StreamEvents, scope, delivered, backlogDrops)
	if backlogDrops > 0 {
		m.telemetry.RecordStreamErrorForDomain(
			telemetry.StreamEvents,
			scope,
			fmt.Errorf("dropped %d event(s) due to backlog", backlogDrops),
		)
	}
}

func (m *Manager) nextSequenceLocked(scope string) uint64 {
	if scope == "" {
		scope = "cluster"
	}
	next := m.sequences[scope] + 1
	m.sequences[scope] = next
	return next
}

func (m *Manager) dropSubscriber(scope string, id uint64, sub *subscription) {
	m.mu.Lock()
	subs, ok := m.subscribers[scope]
	if !ok {
		m.mu.Unlock()
		return
	}
	current, exists := subs[id]
	if !exists || current != sub {
		m.mu.Unlock()
		return
	}
	delete(subs, id)
	if len(subs) == 0 {
		delete(m.subscribers, scope)
		m.clearScopeStateLocked(scope)
	}
	m.mu.Unlock()
	sub.Close()
}

// clearScopeStateLocked removes resume state for scopes without subscribers.
func (m *Manager) clearScopeStateLocked(scope string) {
	if m.buffers != nil {
		delete(m.buffers, scope)
	}
	if m.sequences != nil {
		delete(m.sequences, scope)
	}
}

func (m *Manager) trySend(sub *subscription, entry StreamEvent) (sent bool, closed bool, dropped bool) {
	defer func() {
		if r := recover(); r != nil {
			closed = true
			sent = false
			dropped = false
		}
	}()
	select {
	case sub.ch <- entry:
		return true, false, false
	default:
		// Drop the oldest pending event so slow subscribers keep the stream open.
		select {
		case <-sub.ch:
			dropped = true
		default:
		}
		select {
		case sub.ch <- entry:
			return true, false, dropped
		default:
			return false, false, dropped
		}
	}
}
