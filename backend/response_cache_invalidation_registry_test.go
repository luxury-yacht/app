package backend

import (
	"testing"

	"github.com/luxury-yacht/app/backend/kind/kindregistry"
	"github.com/luxury-yacht/app/backend/resourcecontract"
)

// TestCacheInvalidationKindsMatchContract ties the detail-cacheable kinds in the
// single kind registry to the canonical built-in resource contract: every cacheable
// entry must correspond to a real BuiltinResources entry (by group/resource/kind),
// catching typos and drift from the single source of truth.
func TestCacheInvalidationKindsMatchContract(t *testing.T) {
	inContract := func(group, resource, kind string) bool {
		for _, b := range resourcecontract.BuiltinResources {
			if b.Group == group && b.Resource == resource && b.Kind == kind {
				return true
			}
		}
		return false
	}
	for _, d := range kindregistry.All {
		if !d.DetailCacheable {
			continue
		}
		if !inContract(d.Identity.Group, d.Identity.Resource, d.Identity.Kind) {
			t.Errorf("cacheable kind %q/%q/%q not in BuiltinResources", d.Identity.Group, d.Identity.Resource, d.Identity.Kind)
		}
	}
}

// TestAllRegistryKindsAreDetailCacheable is the reverse-direction guard: the
// forward test above only checks that cacheable kinds are real, so it would not
// catch a kind that silently lost its DetailCacheable facet (its detail/YAML/Helm
// cache would then never be evicted, showing stale data after the object changes).
// Every built-in kind is detail-cacheable today; this pins that invariant so a
// dropped facet fails. If a future kind is intentionally non-cacheable, update this
// guard deliberately.
func TestAllRegistryKindsAreDetailCacheable(t *testing.T) {
	for _, d := range kindregistry.All {
		if !d.DetailCacheable {
			t.Errorf("kind %q/%q/%q is not DetailCacheable; its response cache will never be invalidated — if intentional, update this guard", d.Identity.Group, d.Identity.Resource, d.Identity.Kind)
		}
	}
}
