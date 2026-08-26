package objectcatalog

import (
	"reflect"
	"sort"
	"strings"
)

// FinalizerBlockerUpdate signals that the catalog's blocker subset changed.
// Consumers read the coalesced current value through FinalizerBlockers.
type FinalizerBlockerUpdate struct {
	Revision uint64
}

// FinalizerBlockers returns a deterministic copy of the catalog objects that
// are both deleting and still carry a finalizer.
func (s *Service) FinalizerBlockers() []FinalizerBlocker {
	if s == nil {
		return nil
	}
	s.finalizerMu.RLock()
	blockers := make([]FinalizerBlocker, 0, len(s.finalizerBlockers))
	for _, blocker := range s.finalizerBlockers {
		blockers = append(blockers, blocker)
	}
	s.finalizerMu.RUnlock()
	sort.Slice(blockers, func(left, right int) bool {
		return finalizerBlockerKey(blockers[left]) < finalizerBlockerKey(blockers[right])
	})
	return blockers
}

// SubscribeFinalizerBlockers registers a coalescing lifecycle subscriber and
// immediately sends the current revision.
func (s *Service) SubscribeFinalizerBlockers() (<-chan FinalizerBlockerUpdate, func()) {
	ch := make(chan FinalizerBlockerUpdate, 1)
	s.finalizerMu.Lock()
	id := s.nextFinalizerSubID
	s.nextFinalizerSubID++
	if s.finalizerSubscribers == nil {
		s.finalizerSubscribers = make(map[int]chan FinalizerBlockerUpdate)
	}
	s.finalizerSubscribers[id] = ch
	revision := s.finalizerRevision
	ch <- FinalizerBlockerUpdate{Revision: revision}
	s.finalizerMu.Unlock()

	unsubscribe := func() {
		s.finalizerMu.Lock()
		if subscriber, exists := s.finalizerSubscribers[id]; exists {
			delete(s.finalizerSubscribers, id)
			close(subscriber)
		}
		s.finalizerMu.Unlock()
	}
	return ch, unsubscribe
}

func (s *Service) replaceFinalizerBlockers(items map[string]Summary) {
	if s == nil {
		return
	}
	next := make(map[string]FinalizerBlocker)
	for _, summary := range items {
		blocker, blocked := summary.FinalizerBlocker()
		if !blocked {
			continue
		}
		next[finalizerBlockerKey(blocker)] = blocker
	}

	s.finalizerMu.Lock()
	if reflect.DeepEqual(s.finalizerBlockers, next) {
		s.finalizerMu.Unlock()
		return
	}
	s.finalizerBlockers = next
	s.finalizerRevision++
	update := FinalizerBlockerUpdate{Revision: s.finalizerRevision}
	for _, subscriber := range s.finalizerSubscribers {
		select {
		case <-subscriber:
		default:
		}
		select {
		case subscriber <- update:
		default:
		}
	}
	s.finalizerMu.Unlock()
}

func finalizerBlockerKey(blocker FinalizerBlocker) string {
	ref := blocker.Ref
	return strings.ToLower(strings.Join([]string{
		ref.ClusterID, ref.Group, ref.Version, ref.Kind, ref.Resource, ref.Namespace, ref.Name, ref.UID,
	}, "\x00"))
}
