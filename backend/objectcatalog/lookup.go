/*
 * backend/objectcatalog/lookup.go
 *
 * Provides indexed object lookup helpers for catalog consumers.
 */

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
	return s.catalogIndex.findExact(
		normalizedNamespace,
		normalizedGroup,
		normalizedVersion,
		normalizedKind,
		normalizedName,
	)
}

// ObjectLookup is the catalog's answer for one object identity.
type ObjectLookup struct {
	Summary Summary
	Found   bool
	// Absent is true only when the catalog has completely listed the object's
	// resource, so not finding the object means the cluster does not have it.
	Absent bool
	// Denied names the resource (kubectl-style resource[.group]) when listing
	// it was forbidden; a miss then proves nothing.
	Denied string
}

// LookupObject finds an object by group, kind, namespace, and name under
// whichever served version the catalog lists its resource, so a caller holding
// another served version of the same object still finds it. Every part of the
// answer comes from one publication.
func (s *Service) LookupObject(namespace, group, kind, name string) ObjectLookup {
	if s == nil {
		return ObjectLookup{}
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	idx := &s.catalogIndex
	desc, listed := idx.descriptorForGroupKind(strings.TrimSpace(group), strings.TrimSpace(kind))
	if !listed {
		return ObjectLookup{}
	}
	if summary, found := idx.findExact(normalizeLookupNamespace(namespace), desc.Group, desc.Version, desc.Kind, strings.TrimSpace(name)); found {
		return ObjectLookup{Summary: summary, Found: true}
	}
	resource := deniedResourceName(desc)
	if _, denied := idx.deniedResources[resource]; denied {
		return ObjectLookup{Denied: resource}
	}
	_, complete := idx.completeResources[desc.GVR().String()]
	return ObjectLookup{Absent: complete && idx.cachesAreReady()}
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
	return s.catalogIndex.findUID(normalizedUID)
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
