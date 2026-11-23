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
	// Confirmed distinguishes a row verified by the current publication from
	// last-known data kept for an unread partition.
	Confirmed bool
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
	return s.catalogIndex.lookupObject(namespace, group, kind, name, s.scopeNamespaces())
}

func (idx *catalogIndex) lookupObject(namespace, group, kind, name string, scope []string) ObjectLookup {
	group, kind = strings.TrimSpace(group), strings.TrimSpace(kind)
	namespace = normalizeLookupNamespace(namespace)
	desc, listed := idx.descriptorForGroupKind(group, kind)
	if !listed {
		entry, known := idx.lookupDescriptors[schema.GroupKind{Group: group, Kind: kind}]
		if !known {
			return ObjectLookup{}
		}
		desc = entry.descriptor
		if entry.preflightDenied && (!desc.Namespaced || len(scope) == 0) {
			return ObjectLookup{Denied: deniedResourceName(desc)}
		}
	}
	if idx.listDenied(desc, namespace) {
		return ObjectLookup{Denied: deniedResourceName(desc)}
	}
	confirmed := idx.scopeConfirmed(desc, namespace, scope)
	if summary, found := idx.findExact(namespace, desc.Group, desc.Version, desc.Kind, strings.TrimSpace(name)); found {
		return ObjectLookup{Summary: summary, Found: true, Confirmed: confirmed}
	}
	return ObjectLookup{Absent: confirmed}
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
