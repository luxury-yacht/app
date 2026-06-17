package backend

import (
	"testing"

	"github.com/luxury-yacht/app/backend/refresh/kindregistry"
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
