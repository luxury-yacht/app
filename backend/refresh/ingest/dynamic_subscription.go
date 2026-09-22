package ingest

import "sync"

// Unsubscribing joins a current delivery before the consumer can retire. This
// lock is independent of manager/store ownership; listeners may read the source.
type dynamicSubscription struct {
	mu       sync.Mutex
	listener func(DynamicCatalogChange)
}

func (s *dynamicSubscription) deliver(change DynamicCatalogChange) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.listener != nil {
		s.listener(change)
	}
}

func (s *dynamicSubscription) stop() {
	s.mu.Lock()
	s.listener = nil
	s.mu.Unlock()
}
