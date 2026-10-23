package role

import "github.com/luxury-yacht/app/backend/kind/kindspec"

// Descriptor(s) register role's kind(s) in the single kind registry
// (kind/kindregistry.All): the canonical Identity plus the facets every
// subsystem reads. This is the one place role hands itself to the app.

var Descriptor = kindspec.Descriptor{
	Identity:        Identity,
	Display:         kindspec.Display{ShortName: "role"},
	DetailCacheable: true,
	Stream:          &StreamDescriptor,
	Collector:       &ObjectMapNode,
	Binding:         &DetailBinding,
}
