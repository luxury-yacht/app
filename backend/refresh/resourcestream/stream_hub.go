/*
 * backend/refresh/resourcestream/stream_hub.go
 *
 * Owns resource-stream subscription lifecycle, resume buffering, and fan-out
 * delivery for Manager without mixing that behavior into object-specific update
 * translation.
 */

package resourcestream

import (
	"errors"
	"fmt"
	"strings"
	"sync/atomic"
	"time"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/refresh/telemetry"
)

// SubscribeSelector registers a new subscriber for the supplied typed selector.
func (m *Manager) SubscribeSelector(selector StreamSelector) (*Subscription, error) {
	if err := validateStreamSelector(m, selector); err != nil {
		return nil, err
	}
	domain := selector.Domain
	normalized := selector.CanonicalScope()
	// Avoid pre-checking permissions so partial streams can still deliver updates.
	id, sub, err := m.addSubscriber(domain, normalized)
	if err != nil {
		m.logWarn(err.Error())
		if m.telemetry != nil {
			m.telemetry.RecordStreamError(telemetry.StreamResources, err)
		}
		return nil, err
	}

	return &Subscription{
		Domain:  domain,
		Scope:   normalized,
		Updates: sub.ch,
		Drops:   sub.drops,
		Cancel:  func() { m.dropSubscriber(domain, normalized, id, sub, DropReasonClosed) },
	}, nil
}

func validateStreamSelector(m *Manager, selector StreamSelector) error {
	if m == nil {
		return errors.New("resource stream not initialised")
	}
	if strings.TrimSpace(selector.ClusterID) == "" {
		return errors.New("cluster id is required")
	}
	if selector.ClusterID != m.clusterMeta.ClusterID {
		return errors.New("cluster mismatch")
	}
	return nil
}

func (m *Manager) addSubscriber(domain, scope string) (uint64, *subscription, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.stopped.Load() {
		return 0, nil, errors.New("resource stream stopped")
	}
	domainSubscribers := m.subscribers[domain]
	if domainSubscribers == nil {
		domainSubscribers = make(map[string]map[uint64]*subscription)
		m.subscribers[domain] = domainSubscribers
	}
	subscribers := domainSubscribers[scope]
	if subscribers == nil {
		subscribers = make(map[uint64]*subscription)
		domainSubscribers[scope] = subscribers
	}
	if len(subscribers) >= config.ResourceStreamMaxSubscribersPerScope {
		return 0, nil, fmt.Errorf("resource stream subscriber limit reached for %s/%s", domain, scope)
	}
	id := atomic.AddUint64(&m.nextID, 1)
	sub := &subscription{
		ch:      make(chan Update, config.ResourceStreamSubscriberBufferSize),
		drops:   make(chan DropReason, 1),
		created: time.Now(),
	}
	subscribers[id] = sub
	return id, sub, nil
}

// ResumeSelector returns buffered updates after the provided sequence token.
func (m *Manager) ResumeSelector(selector StreamSelector, since uint64) ([]Update, bool) {
	if validateStreamSelector(m, selector) != nil || since == 0 {
		return nil, false
	}
	key := bufferKey(selector.Domain, selector.CanonicalScope())
	m.mu.RLock()
	buffer := m.buffers[key]
	if buffer == nil {
		m.mu.RUnlock()
		return nil, false
	}
	updates, ok := buffer.Since(since)
	m.mu.RUnlock()
	if !ok {
		return nil, false
	}
	results := make([]Update, 0, len(updates))
	for _, item := range updates {
		results = append(results, item.update)
	}
	return results, true
}

func (m *Manager) broadcast(domain string, scopes []string, update Update) {
	m.invalidateSnapshotDomain(domain)
	if m == nil || len(scopes) == 0 {
		return
	}

	// Fan-out updates per scope and trigger a RESET when subscribers fall behind.
	for _, scope := range uniqueScopes(scopes) {
		result := m.broadcastScope(domain, scope, update)
		m.recordBroadcastResult(domain, scope, result)
	}
}

type broadcastResult struct {
	delivered          int
	backpressureResets int
	backpressureDrops  int
	closed             int
}

func (m *Manager) broadcastScope(domain, scope string, update Update) broadcastResult {
	var result broadcastResult
	scopedUpdate, items := m.prepareBroadcast(domain, scope, update)
	for _, item := range items {
		if item.sub.isResyncing() {
			continue
		}
		sent, closed, reset := m.trySend(item.sub, scopedUpdate)
		switch {
		case closed:
			result.closed++
			go m.dropSubscriber(domain, scope, item.id, item.sub, DropReasonClosed)
		case reset:
			result.backpressureResets++
		case sent:
			result.delivered++
		default:
			result.backpressureDrops++
			go m.dropSubscriber(domain, scope, item.id, item.sub, DropReasonBackpressure)
		}
	}
	return result
}

func (m *Manager) recordBroadcastResult(domain, scope string, result broadcastResult) {
	backpressureEvents := result.backpressureResets + result.backpressureDrops
	if m.telemetry != nil {
		// Attribute deliveries/drops to the resource domain so diagnostics can
		// show one Streams row per domain (sessions/connect stay stream-level).
		m.telemetry.RecordStreamDeliveryForLeaf(telemetry.StreamResources, telemetry.DomainLeaf(domain), result.delivered, backpressureEvents)
		if backpressureEvents > 0 {
			m.telemetry.RecordStreamErrorForLeaf(
				telemetry.StreamResources,
				telemetry.DomainLeaf(domain),
				fmt.Errorf(
					"resource stream backlog reset %d subscriber(s) and dropped %d subscriber(s) for %s/%s",
					result.backpressureResets,
					result.backpressureDrops,
					domain,
					scope,
				),
			)
		}
	}
	if result.closed > 0 {
		m.logInfo(fmt.Sprintf("resource stream: cleaned up %d closed subscribers for %s/%s", result.closed, domain, scope))
	}
}
