/*
 * backend/objectcatalog/state.go
 *
 * Catalog state accessors and snapshots.
 */

package objectcatalog

import (
	"sort"
	"time"
)

// Snapshot returns a copy of the current catalog contents.
func (s *Service) Snapshot() []Summary {
	s.mu.RLock()
	defer s.mu.RUnlock()
	result := make([]Summary, 0, len(s.items))
	for _, item := range s.items {
		result = append(result, item)
	}
	return result
}

// Count reports the number of catalogued objects.
func (s *Service) Count() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.items)
}

// Namespaces returns the cached namespace list for this catalog.
func (s *Service) Namespaces() []string {
	s.mu.RLock()
	cached := append([]string(nil), s.cachedNamespaces...)
	items := s.items
	s.mu.RUnlock()

	if len(cached) > 0 {
		return cached
	}
	if len(items) == 0 {
		return nil
	}

	namespaceSet := make(map[string]struct{})
	for _, summary := range items {
		if summary.Namespace != "" {
			namespaceSet[summary.Namespace] = struct{}{}
		}
	}
	return snapshotSortedKeys(namespaceSet)
}

// Descriptors returns the catalogued resource definitions discovered during the last sync.
func (s *Service) Descriptors() []Descriptor {
	s.mu.RLock()
	defer s.mu.RUnlock()
	result := make([]Descriptor, 0, len(s.resources))
	for _, desc := range s.resources {
		result = append(result, exportDescriptor(desc))
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].Group != result[j].Group {
			return result[i].Group < result[j].Group
		}
		if result[i].Version != result[j].Version {
			return result[i].Version < result[j].Version
		}
		if result[i].Resource != result[j].Resource {
			return result[i].Resource < result[j].Resource
		}
		return result[i].Kind < result[j].Kind
	})
	return result
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
	return s.items, s.lastSeen, len(s.resources)
}
