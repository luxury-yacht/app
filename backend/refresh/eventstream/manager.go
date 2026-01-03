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

	"github.com/luxury-yacht/app/backend/internal/timeutil"
	"github.com/luxury-yacht/app/backend/refresh/telemetry"
)

const (
	// maxSubscribersPerScope limits concurrent subscribers per scope to prevent memory exhaustion.
	maxSubscribersPerScope = 100
	// resumeBufferSize caps stored events per scope for resume tokens.
	resumeBufferSize = 1000
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
	if _, ok := m.subscribers[scope]; !ok {
		m.subscribers[scope] = make(map[uint64]*subscription)
	}

	// Check subscriber limit before adding
	if len(m.subscribers[scope]) >= maxSubscribersPerScope {
		m.mu.Unlock()
		m.logger.Warn(fmt.Sprintf("eventstream: subscriber limit (%d) reached for scope %s", maxSubscribersPerScope, scope), "EventStream")
		if m.telemetry != nil {
			m.telemetry.RecordStreamError(telemetry.StreamEvents, fmt.Errorf("subscriber limit reached for scope %s", scope))
		}
		return nil, func() {}
	}

	ch := make(chan StreamEvent, 256)
	id := atomic.AddUint64(&m.nextID, 1)
	m.subscribers[scope][id] = &subscription{ch: ch, created: time.Now()}
	m.mu.Unlock()

	cancel := func() {
		m.mu.Lock()
		defer m.mu.Unlock()
		if subs, ok := m.subscribers[scope]; ok {
			if sub, exists := subs[id]; exists {
				sub.Close()
				delete(subs, id)
			}
			if len(subs) == 0 {
				delete(m.subscribers, scope)
			}
		}
	}

	return ch, cancel
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
	sequence := m.nextSequenceLocked(scope)
	buffer := m.bufferLocked(scope)
	buffer.add(bufferedEvent{sequence: sequence, entry: entry})
	subscribers := m.subscribers[scope]
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
		sent, closed := m.trySend(sub, streamEvent)
		if closed {
			closedCount++
			go m.dropSubscriber(scope, item.id, sub)
			continue
		}
		if sent {
			delivered++
			continue
		}
		m.logger.Warn("eventstream: subscriber channel full; dropping", "EventStream")
		backlogDrops++
		go m.dropSubscriber(scope, item.id, sub)
	}
	m.recordDelivery(scope, delivered, backlogDrops, closedCount)
}

func (m *Manager) recordDelivery(scope string, delivered, backlogDrops, closed int) {
	if m.telemetry == nil {
		return
	}
	m.telemetry.RecordStreamDelivery(telemetry.StreamEvents, delivered, backlogDrops)
	if backlogDrops > 0 {
		m.telemetry.RecordStreamError(
			telemetry.StreamEvents,
			fmt.Errorf("dropped %d subscriber(s) due to backlog", backlogDrops),
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

func (m *Manager) bufferLocked(scope string) *eventBuffer {
	if scope == "" {
		scope = "cluster"
	}
	buffer := m.buffers[scope]
	if buffer == nil {
		buffer = newEventBuffer(resumeBufferSize)
		m.buffers[scope] = buffer
	}
	return buffer
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
	}
	m.mu.Unlock()
	sub.Close()
}

func (m *Manager) trySend(sub *subscription, entry StreamEvent) (sent bool, closed bool) {
	defer func() {
		if r := recover(); r != nil {
			closed = true
			sent = false
		}
	}()
	select {
	case sub.ch <- entry:
		return true, false
	default:
		return false, false
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
