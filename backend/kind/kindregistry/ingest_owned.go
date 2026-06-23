package kindregistry

import (
	"github.com/luxury-yacht/app/backend/kind/kindspec"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

// IngestOwnedDescriptors returns every kind cut over to the owned-reflector ingest
// path (the IngestOwned facet), in registry order. The ingest wiring loops this to
// register a maintained-store/catalog/object-map/response-cache consumer per cut
// kind; no subsystem names a kind itself.
func IngestOwnedDescriptors() []kindspec.Descriptor {
	out := make([]kindspec.Descriptor, 0, len(All))
	for _, d := range All {
		if d.IngestOwned {
			out = append(out, d)
		}
	}
	return out
}

// IngestOwnedGVRs returns the set of GVRs cut over to the ingest path. Every
// subsystem that would otherwise read these kinds from the shared informer (the
// catalog, the object map, the response-cache invalidator, the typed-table
// maintained store) asks this set "is this GVR ingest-owned?" so adding the next
// domain is flipping the IngestOwned facet, not new per-subsystem code.
func IngestOwnedGVRs() map[schema.GroupVersionResource]struct{} {
	out := make(map[schema.GroupVersionResource]struct{})
	for _, d := range All {
		if d.IngestOwned {
			out[d.Identity.GVR()] = struct{}{}
		}
	}
	return out
}
