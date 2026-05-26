package objectcatalog

import (
	"context"
	"strings"

	"github.com/luxury-yacht/app/backend/resources/common"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

// FindExactMatch resolves a single catalog item by canonical identity within
// this cluster's catalog snapshot.
func (s *Service) FindExactMatch(namespace, group, version, kind, name string) (Summary, bool) {
	if s == nil {
		return Summary{}, false
	}

	normalizedNamespace := normalizeLookupNamespace(namespace)
	normalizedGroup := strings.TrimSpace(group)
	normalizedVersion := strings.TrimSpace(version)
	normalizedKind := strings.TrimSpace(kind)
	normalizedName := strings.TrimSpace(name)
	if normalizedVersion == "" || normalizedKind == "" || normalizedName == "" {
		return Summary{}, false
	}

	s.mu.RLock()
	defer s.mu.RUnlock()

	for _, item := range s.items {
		if item.Namespace != normalizedNamespace {
			continue
		}
		if item.Group != normalizedGroup {
			continue
		}
		if item.Version != normalizedVersion {
			continue
		}
		if item.Kind != normalizedKind {
			continue
		}
		if item.Name != normalizedName {
			continue
		}
		return item, true
	}

	return Summary{}, false
}

// FindByUID resolves a single catalog item by UID within this cluster's
// catalog snapshot.
func (s *Service) FindByUID(uid string) (Summary, bool) {
	if s == nil {
		return Summary{}, false
	}

	normalizedUID := strings.TrimSpace(uid)
	if normalizedUID == "" {
		return Summary{}, false
	}

	s.mu.RLock()
	defer s.mu.RUnlock()

	for _, item := range s.items {
		if item.UID == normalizedUID {
			return item, true
		}
	}

	return Summary{}, false
}

// ResolveResourceForGVK resolves discovery metadata captured by the catalog.
// It implements common.ResourceResolver without exposing catalog internals to
// dynamic action, permission, or YAML callers.
func (s *Service) ResolveResourceForGVK(ctx context.Context, gvk schema.GroupVersionKind) (common.ResolvedResource, bool, error) {
	if s == nil {
		return common.ResolvedResource{}, false, nil
	}
	if s.identity == nil {
		return common.ResolvedResource{}, false, nil
	}
	return s.identity.ResolveResourceForGVK(ctx, gvk)
}

func normalizeLookupNamespace(namespace string) string {
	trimmed := strings.TrimSpace(namespace)
	if trimmed == "" {
		return ""
	}
	if strings.EqualFold(trimmed, "cluster") {
		return ""
	}
	if strings.EqualFold(trimmed, "__cluster__") {
		return ""
	}
	return trimmed
}
