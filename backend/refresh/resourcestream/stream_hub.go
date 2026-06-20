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
	"sync/atomic"
	"time"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/refresh/telemetry"
)

// managerStreamHub owns subscription lifecycle and fan-out behavior for a Manager.
type managerStreamHub struct {
	manager *Manager
}

func (m *Manager) streamHub() managerStreamHub {
	return managerStreamHub{manager: m}
}

func (h managerStreamHub) subscribe(selector StreamSelector) (*Subscription, error) {
	m := h.manager
	if m == nil {
		return nil, errors.New("resource stream not initialised")
	}
	if selector.ClusterID != "" && selector.ClusterID != m.clusterMeta.ClusterID {
		return nil, errors.New("cluster mismatch")
	}
	domain := selector.Domain
	normalized := selector.CanonicalScope()
	// Avoid pre-checking permissions so partial streams can still deliver updates.

	m.mu.Lock()
	scopeSubscribers, ok := m.subscribers[domain]
	if !ok {
		scopeSubscribers = make(map[string]map[uint64]*subscription)
		m.subscribers[domain] = scopeSubscribers
	}

	subs, ok := scopeSubscribers[normalized]
	if !ok {
		subs = make(map[uint64]*subscription)
		scopeSubscribers[normalized] = subs
	}
	if len(subs) >= config.ResourceStreamMaxSubscribersPerScope {
		m.mu.Unlock()
		err := fmt.Errorf("resource stream subscriber limit reached for %s/%s", domain, normalized)
		m.logWarn(err.Error())
		if m.telemetry != nil {
			m.telemetry.RecordStreamError(telemetry.StreamResources, err)
		}
		return nil, err
	}

	id := atomic.AddUint64(&m.nextID, 1)
	sub := &subscription{
		ch:      make(chan Update, config.ResourceStreamSubscriberBufferSize),
		drops:   make(chan DropReason, 1),
		created: time.Now(),
	}
	subs[id] = sub
	m.mu.Unlock()

	cancel := func() {
		m.mu.Lock()
		defer m.mu.Unlock()
		if domainSubs, ok := m.subscribers[domain]; ok {
			if scopeSubs, ok := domainSubs[normalized]; ok {
				if current, exists := scopeSubs[id]; exists && current == sub {
					delete(scopeSubs, id)
					if len(scopeSubs) == 0 {
						delete(domainSubs, normalized)
						m.clearScopeStateLocked(domain, normalized)
					}
					sub.close(DropReasonClosed)
				}
			}
			if len(domainSubs) == 0 {
				delete(m.subscribers, domain)
			}
		}
	}

	return &Subscription{
		Domain:  domain,
		Scope:   normalized,
		Updates: sub.ch,
		Drops:   sub.drops,
		Cancel:  cancel,
	}, nil
}

func (h managerStreamHub) resume(selector StreamSelector, since uint64) ([]Update, bool) {
	m := h.manager
	if m == nil || since == 0 {
		return nil, false
	}
	if selector.ClusterID != "" && selector.ClusterID != m.clusterMeta.ClusterID {
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

func (h managerStreamHub) broadcast(domain string, scopes []string, update Update) {
	m := h.manager
	if m == nil || len(scopes) == 0 {
		return
	}

	// Fan-out updates per scope and trigger a RESET when subscribers fall behind.
	for _, scope := range uniqueScopes(scopes) {
		delivered := 0
		backpressureResets := 0
		backpressureDrops := 0
		closedCount := 0

		scopedUpdate, items := m.prepareBroadcast(domain, scope, update)
		for _, item := range items {
			if item.sub.isResyncing() {
				continue
			}
			sent, closed, reset := m.trySend(item.sub, scopedUpdate)
			if closed {
				closedCount++
				go m.dropSubscriber(domain, scope, item.id, item.sub, DropReasonClosed)
				continue
			}
			if reset {
				backpressureResets++
				continue
			}
			if sent {
				delivered++
				continue
			}
			backpressureDrops++
			go m.dropSubscriber(domain, scope, item.id, item.sub, DropReasonBackpressure)
		}

		if m.telemetry != nil {
			backpressureEvents := backpressureResets + backpressureDrops
			// Attribute deliveries/drops to the resource domain so diagnostics can
			// show one Streams row per domain (sessions/connect stay stream-level).
			m.telemetry.RecordStreamDeliveryForDomain(telemetry.StreamResources, domain, delivered, backpressureEvents)
			if backpressureEvents > 0 {
				m.telemetry.RecordStreamErrorForDomain(
					telemetry.StreamResources,
					domain,
					fmt.Errorf(
						"resource stream backlog reset %d subscriber(s) and dropped %d subscriber(s) for %s/%s",
						backpressureResets,
						backpressureDrops,
						domain,
						scope,
					),
				)
			}
		}
		if closedCount > 0 {
			m.logInfo(fmt.Sprintf("resource stream: cleaned up %d closed subscribers for %s/%s", closedCount, domain, scope))
		}
	}
}
