package objectcatalog

import (
	"github.com/luxury-yacht/app/backend/resourcekind"
	"sort"
)

// DiscoveredResourceFamilies describes installed APIs, including kinds with zero
// objects or denied LIST access. The discovery identity store is replaced on
// successful discovery, independently of the permission-filtered row catalog.
type ResourceFamilies struct {
	Cluster    []string `json:"cluster,omitempty"`
	Namespaced []string `json:"namespaced,omitempty"`
}

func (s *Service) DiscoveredResourceFamilies() ResourceFamilies {
	result := ResourceFamilies{}
	if s == nil || s.identity == nil {
		return result
	}
	s.identity.mu.RLock()
	defer s.identity.mu.RUnlock()
	cluster, namespaced := make(map[string]bool), make(map[string]bool)
	for _, desc := range s.identity.resources {
		if family := resourcekind.FamilyForResource(desc.Group, desc.Kind, desc.Namespaced); family != "" {
			if desc.Namespaced {
				namespaced[family] = true
			} else {
				cluster[family] = true
			}
		}
	}
	for family := range cluster {
		result.Cluster = append(result.Cluster, family)
	}
	for family := range namespaced {
		result.Namespaced = append(result.Namespaced, family)
	}
	sort.Strings(result.Cluster)
	sort.Strings(result.Namespaced)
	return result
}
