package objectcatalog

import (
	"github.com/luxury-yacht/app/backend/resourcekind"
	"sort"
)

// DiscoveredResourceFamilies describes installed APIs, including kinds with zero
// objects or denied LIST access. The discovery identity store is replaced on
// successful discovery, independently of the permission-filtered row catalog.
func (s *Service) DiscoveredResourceFamilies() []string {
	if s == nil || s.identity == nil {
		return nil
	}
	s.identity.mu.RLock()
	defer s.identity.mu.RUnlock()
	families := make(map[string]struct{})
	for _, desc := range s.identity.resources {
		if family := resourcekind.FamilyForResource(desc.Group, desc.Namespaced); family != "" {
			families[family] = struct{}{}
		}
	}
	result := make([]string, 0, len(families))
	for family := range families {
		result = append(result, family)
	}
	sort.Strings(result)
	return result
}
