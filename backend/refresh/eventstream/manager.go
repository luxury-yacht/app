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

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/internal/timeutil"
	"github.com/luxury-yacht/app/backend/refresh/telemetry"
)

// Manager fan-outs informer updates to subscribed streaming clients.
type Manager struct {
	informer coreinformers.EventInformer
	logger   Logger

	mu          sync.RWMutex
	subscribers map[string]map[uint64]*subscription
	buffers     map[string]*eventBuffer
	sequences   map[string]uint64
	nextID      uint64
	telemetry   *telemetry.Recorder
}

type bufferedEvent struct {
	sequence uint64
	entry    Entry
}

type eventBuffer struct {
	items []bufferedEvent
	start int
	count int
	max   int
}

func newEventBuffer(max int) *eventBuffer {
	return &eventBuffer{
		items: make([]bufferedEvent, max),
		max:   max,
	}
}

func (b *eventBuffer) add(event bufferedEvent) {
	if b.max == 0 {
		return
	}
	if b.count < b.max {
		index := (b.start + b.count) % b.max
		b.items[index] = event
		b.count++
		return
	}
	b.items[b.start] = event
	b.start = (b.start + 1) % b.max
}

func (b *eventBuffer) since(sequence uint64) ([]bufferedEvent, bool) {
	if b.count == 0 {
		return nil, false
	}
	oldest := b.items[b.start].sequence
	latestIndex := (b.start + b.count - 1) % b.max
	latest := b.items[latestIndex].sequence
	if sequence < oldest {
		return nil, false
	}
	if sequence >= latest {
		return []bufferedEvent{}, true
	}
	events := make([]bufferedEvent, 0, b.count)
	for i := 0; i < b.count; i++ {
		index := (b.start + i) % b.max
		item := b.items[index]
		if item.sequence > sequence {
			events = append(events, item)
		}
	}
	return events, true
}

// NewManager wires the event informer into a streaming manager.
func NewManager(informer coreinformers.EventInformer, logger Logger, recorder *telemetry.Recorder) *Manager {
	if logger == nil {
		logger = noopLogger{}
	}
	m := &Manager{
		informer:    informer,
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
	items, ok := buffer.since(since)
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
	items, ok := buffer.since(since)
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
		m.logger.Warn(
			fmt.Sprintf(
				"eventstream: subscriber limit (%d) reached for scope %s",
				config.EventStreamMaxSubscribersPerScope,
				scope,
			),
			"EventStream",
		)
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

	entry := Entry{
		Kind:            evt.InvolvedObject.Kind,
		Name:            evt.Name,
		Namespace:       evt.InvolvedObject.Namespace,
		ObjectNamespace: evt.InvolvedObject.Namespace,
		Type:            evt.Type,
		Source:          formatSource(evt),
		Reason:          evt.Reason,
		Object:          formatObject(evt),
		Message:         evt.Message,
	}

	lastSeen := timeutil.LatestEventTimestamp(evt)
	if lastSeen.IsZero() {
		lastSeen = time.Now()
	}
	entry.CreatedAt = lastSeen.UnixMilli()
	entry.Age = timeutil.FormatAge(lastSeen)

	m.broadcast("cluster", entry)
	if entry.ObjectNamespace != "" {
		m.broadcast("namespace:"+entry.ObjectNamespace, entry)
	}
}

func (m *Manager) broadcast(scope string, entry Entry) {
	m.mu.Lock()
	subscribers := m.subscribers[scope]
	buffer := m.buffers[scope]
	// Only keep resume buffers when active or recent subscribers exist.
	shouldBuffer := len(subscribers) > 0 || buffer != nil
	var sequence uint64
	if shouldBuffer {
		sequence = m.nextSequenceLocked(scope)
		if buffer == nil {
			buffer = newEventBuffer(config.EventStreamResumeBufferSize)
			m.buffers[scope] = buffer
		}
		buffer.add(bufferedEvent{sequence: sequence, entry: entry})
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
		m.logger.Warn("eventstream: subscriber channel full after drop attempt; closing", "EventStream")
		go m.dropSubscriber(scope, item.id, sub)
	}
	m.recordDelivery(delivered, backlogDrops)
}

func (m *Manager) recordDelivery(delivered, backlogDrops int) {
	if m.telemetry == nil {
		return
	}
	m.telemetry.RecordStreamDelivery(telemetry.StreamEvents, delivered, backlogDrops)
	if backlogDrops > 0 {
		m.telemetry.RecordStreamError(
			telemetry.StreamEvents,
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

func formatSource(evt *corev1.Event) string {
	if evt == nil {
		return ""
	}
	source := evt.Source.Component
	if evt.Source.Host != "" {
		source = source + "/" + evt.Source.Host
	}
	if source == "" {
		source = evt.ReportingController
	}
	return source
}

func formatObject(evt *corev1.Event) string {
	if evt == nil {
		return ""
	}
	obj := evt.InvolvedObject
	if obj.Name == "" {
		return obj.Kind
	}
	return obj.Kind + "/" + obj.Name
}
