package backend

import (
	"testing"

	"github.com/luxury-yacht/app/backend/resourcecontract"
)

// TestCacheInvalidationDescriptorsMatchContract ties the cache-invalidation
// descriptor tables to the canonical built-in resource contract: every entry
// must correspond to a real BuiltinResources entry (by group/resource/kind),
// catching typos and drift from the single source of truth.
func TestCacheInvalidationDescriptorsMatchContract(t *testing.T) {
	inContract := func(group, resource, kind string) bool {
		for _, b := range resourcecontract.BuiltinResources {
			if b.Group == group && b.Resource == resource && b.Kind == kind {
				return true
			}
		}
		return false
	}
	for _, d := range sharedCacheInvalidationDescriptors {
		if !inContract(d.group, d.resource, d.kind) {
			t.Errorf("shared cache-invalidation descriptor %q/%q/%q not in BuiltinResources", d.group, d.resource, d.kind)
		}
	}
	for _, d := range gatewayCacheInvalidationDescriptors {
		if !inContract(d.group, d.resource, d.kind) {
			t.Errorf("gateway cache-invalidation descriptor %q/%q/%q not in BuiltinResources", d.group, d.resource, d.kind)
		}
	}
}
