package kindregistry

import "testing"

// TestRegistryKindCount pins the number of registered kinds. Adding or removing a
// kind is deliberate, and every subsystem derives its kind set from this registry
// by facet, so when this count changes the per-subsystem drift guards must be
// updated in lockstep so the new/removed kind's facets are accounted for
// everywhere:
//
//   - object map + stream-summary: backend/refresh/snapshot/registry_drift_test.go
//   - object catalog sources:      backend/objectcatalog/informer_registry_test.go
//   - response-cache invalidation: backend/response_cache_invalidation_registry_test.go
//   - resource-stream descriptors: backend/refresh/resourcestream/stream_registration_registry_test.go
//
// This count is the backstop that catches a new kind which was added to All but
// participates in no facet the other guards pin: bumping it forces a conscious
// review of all of them.
func TestRegistryKindCount(t *testing.T) {
	const want = 40
	if len(All) != want {
		t.Errorf("kindregistry.All has %d kinds, want %d — update the per-subsystem drift guards listed in this test's doc comment", len(All), want)
	}
}
