package referencegrant

import "github.com/luxury-yacht/app/backend/refresh/kindspec"

// Descriptor(s) register referencegrant's kind(s) in the single kind registry
// (refresh/kindregistry.All): the canonical Identity plus the facets every
// subsystem reads. This is the one place referencegrant hands itself to the app.

var Descriptor = kindspec.Descriptor{
	Identity:         Identity,
	CatalogSource:    kindspec.CatalogGateway,
	DetailCacheable:  true,
	Stream:           &StreamDescriptor,
	GatewayCollector: &ObjectMapNode,
	Edges:            ObjectMapEdges,
	Binding:          &DetailBinding,
}
