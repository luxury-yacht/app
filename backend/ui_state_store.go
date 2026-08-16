package backend

import "sync"

// UIStateStore owns persistence.json and its I/O lock.
type UIStateStore struct {
	mu sync.Mutex
}

func NewUIStateStore() *UIStateStore { return &UIStateStore{} }

func (s *UIStateStore) Reset() error {
	if s == nil {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return removeResolvedFile(s.getPersistenceFilePath)
}
