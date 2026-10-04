package objectcatalog

import (
	"reflect"
	"sort"
	"strings"
	"sync"

	"github.com/luxury-yacht/app/backend/resourcemodel"
)

// SubsetUpdate signals that one of the catalog's backend-only subsets changed.
// Consumers read the coalesced current value from that subset.
type SubsetUpdate struct {
	Revision uint64
}

// catalogSubsetItem is one entry of a catalog subset, keyed by its object identity.
type catalogSubsetItem interface {
	subsetRef() resourcemodel.ResourceRef
}

// catalogSubset is a coalesced, backend-only projection of the catalog rows that
// Attention consumes (objects blocked on finalizers, objects reporting a status).
// Subscribers are told only when the projected subset itself changes, so catalog
// churn such as resource-version bumps never reaches them. The zero value is ready.
type catalogSubset[T catalogSubsetItem] struct {
	mu          sync.RWMutex
	items       map[string]T
	revision    uint64
	subscribers map[int]chan SubsetUpdate
	nextSubID   int
}

// snapshot returns a deterministic copy of the subset.
func (c *catalogSubset[T]) snapshot() []T {
	c.mu.RLock()
	keys := make([]string, 0, len(c.items))
	for key := range c.items {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	items := make([]T, 0, len(keys))
	for _, key := range keys {
		items = append(items, c.items[key])
	}
	c.mu.RUnlock()
	return items
}

// subscribe registers a coalescing subscriber and immediately sends the current revision.
func (c *catalogSubset[T]) subscribe() (<-chan SubsetUpdate, func()) {
	ch := make(chan SubsetUpdate, 1)
	c.mu.Lock()
	id := c.nextSubID
	c.nextSubID++
	if c.subscribers == nil {
		c.subscribers = make(map[int]chan SubsetUpdate)
	}
	c.subscribers[id] = ch
	ch <- SubsetUpdate{Revision: c.revision}
	c.mu.Unlock()

	unsubscribe := func() {
		c.mu.Lock()
		if subscriber, exists := c.subscribers[id]; exists {
			delete(c.subscribers, id)
			close(subscriber)
		}
		c.mu.Unlock()
	}
	return ch, unsubscribe
}

// replace rebuilds the subset from a complete catalog row set.
func (c *catalogSubset[T]) replace(items map[string]Summary, extract func(Summary) (T, bool)) {
	next := make(map[string]T)
	for _, summary := range items {
		if item, included := extract(summary); included {
			next[catalogSubsetKey(item)] = item
		}
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if reflect.DeepEqual(c.items, next) {
		return
	}
	c.items = next
	c.publishLocked()
}

// update coalesces only the affected identities, so a batch that restores the
// same subset does not emit a revision and unrelated catalog rows are not scanned.
func (c *catalogSubset[T]) update(changes []catalogChange, extract func(Summary) (T, bool)) {
	next := make(map[string]*T)
	for _, change := range changes {
		if change.previous != nil {
			if item, included := extract(*change.previous); included {
				next[catalogSubsetKey(item)] = nil
			}
		}
		if change.next != nil {
			if item, included := extract(*change.next); included {
				next[catalogSubsetKey(item)] = &item
			}
		}
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.applyChangesLocked(next) {
		c.publishLocked()
	}
}

func (c *catalogSubset[T]) applyChangesLocked(next map[string]*T) bool {
	changed := false
	for key, item := range next {
		previous, exists := c.items[key]
		if item == nil {
			if exists {
				delete(c.items, key)
				changed = true
			}
			continue
		}
		if exists && reflect.DeepEqual(previous, *item) {
			continue
		}
		if c.items == nil {
			c.items = make(map[string]T)
		}
		c.items[key] = *item
		changed = true
	}
	return changed
}

func (c *catalogSubset[T]) publishLocked() {
	c.revision++
	update := SubsetUpdate{Revision: c.revision}
	for _, subscriber := range c.subscribers {
		select {
		case <-subscriber:
		default:
		}
		select {
		case subscriber <- update:
		default:
		}
	}
}

func catalogSubsetKey(item catalogSubsetItem) string {
	ref := item.subsetRef()
	return strings.ToLower(strings.Join([]string{
		ref.ClusterID, ref.Group, ref.Version, ref.Kind, ref.Resource, ref.Namespace, ref.Name, ref.UID,
	}, "\x00"))
}
