package gatewayclass

import "github.com/luxury-yacht/app/backend/kind/kindspec"

// Descriptor(s) register gatewayclass's kind(s) in the single kind registry
// (kind/kindregistry.All): the canonical Identity plus the facets every
// subsystem reads. This is the one place gatewayclass hands itself to the app.

var Descriptor = kindspec.Descriptor{
	Identity:        Identity,
	Display:         kindspec.Display{ShortName: "gwclass"},
	DetailCacheable: true,
	Stream:          &StreamDescriptor,
	Collector:       &ObjectMapNode,
	Edges:           ObjectMapEdges,
	Binding:         &DetailBinding,
}
