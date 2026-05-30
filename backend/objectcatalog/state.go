/*
 * backend/objectcatalog/state.go
 *
 * Catalog state accessors and snapshots.
 */

package objectcatalog

import "time"

// Snapshot returns a copy of the current catalog contents.
func (s *Service) Snapshot() []Summary {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.catalogIndex.snapshot()
}

// Count reports the number of catalogued objects.
func (s *Service) Count() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.catalogIndex.count()
}

// Namespaces returns the cached namespace list for this catalog.
func (s *Service) Namespaces() []string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.catalogIndex.namespaces()
}

// Descriptors returns the catalogued resource definitions discovered during the last sync.
func (s *Service) Descriptors() []Descriptor {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.catalogIndex.descriptors()
}

// Health returns the current health snapshot of the catalog service.
func (s *Service) Health() HealthStatus {
	s.healthMu.RLock()
	defer s.healthMu.RUnlock()
	return HealthStatus{
		Status:              s.health.State,
		ConsecutiveFailures: s.health.ConsecutiveFailures,
		LastSync:            s.health.LastSync,
		LastSuccess:         s.health.LastSuccess,
		LastError:           s.health.LastError,
		Stale:               s.health.Stale,
		FailedResources:     s.health.FailedResources,
	}
}

func (s *Service) captureCurrentState() (map[string]Summary, map[string]time.Time, int) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.items, s.lastSeen, s.catalogIndex.descriptorCount()
}
