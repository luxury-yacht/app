package objectcatalog

import (
	"strings"

	"github.com/luxury-yacht/app/backend/resourcemodel"
)

// ResolveRelatedResourceLink completes a versionless relationship only when
// this cluster's discovery identifies one matching API. It does no API work,
// so an unavailable catalog never blocks loading the referring object.
func (s *Service) ResolveRelatedResourceLink(link *resourcemodel.ResourceLink) *resourcemodel.ResourceLink {
	if s == nil || s.identity == nil || link == nil || link.Ref != nil || link.Display == nil {
		return link
	}
	display := *link.Display
	if display.ClusterID != s.clusterID || display.Group == "" || resourcemodel.ValidateDisplayRef(display) != nil {
		return link
	}
	desc, ok := s.identity.relatedResourceDescriptor(display)
	if !ok {
		return link
	}
	ref := resourcemodel.ResourceRef(display)
	ref.Group, ref.Version, ref.Kind, ref.Resource = desc.Group, desc.Version, desc.Kind, desc.Resource
	resolved := resourcemodel.NewResourceLink(resourcemodel.NewResourceRef(ref))
	return &resolved
}

func (r *resourceIdentityResolver) relatedResourceDescriptor(display resourcemodel.DisplayRef) (resourceDescriptor, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	var match resourceDescriptor
	found := false
	for _, desc := range r.resources {
		if !matchesRelatedResource(display, desc) {
			continue
		}
		if found {
			return resourceDescriptor{}, false
		}
		match, found = desc, true
	}
	return match, found
}

func matchesRelatedResource(display resourcemodel.DisplayRef, desc resourceDescriptor) bool {
	return display.Group == desc.Group && strings.EqualFold(display.Kind, desc.Kind) &&
		(display.Version == "" || display.Version == desc.Version) &&
		(display.Resource == "" || display.Resource == desc.Resource) &&
		(display.Namespace != "") == desc.Namespaced
}
