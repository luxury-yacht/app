package httproute

import "github.com/luxury-yacht/app/backend/kind/kindspec"

// Descriptor(s) register httproute's kind(s) in the single kind registry
// (kind/kindregistry.All): the canonical Identity plus the facets every
// subsystem reads. This is the one place httproute hands itself to the app.

var Descriptor = kindspec.Descriptor{
	Identity:        Identity,
	Display:         kindspec.Display{ShortName: "httproute"},
	DetailCacheable: true,
	Stream:          &StreamDescriptor,
	Collector:       &ObjectMapNode,
	Edges:           ObjectMapEdges,
	Binding:         &DetailBinding,
}
