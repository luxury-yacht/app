package gatewayclass

import "github.com/luxury-yacht/app/backend/kind/kindspec"

// Descriptor(s) register gatewayclass's kind(s) in the single kind registry
// (refresh/kindregistry.All): the canonical Identity plus the facets every
// subsystem reads. This is the one place gatewayclass hands itself to the app.

var Descriptor = kindspec.Descriptor{
	Identity:         Identity,
	CatalogSource:    kindspec.CatalogGateway,
	DetailCacheable:  true,
	Stream:           &StreamDescriptor,
	GatewayCollector: &ObjectMapNode,
	Edges:            ObjectMapEdges,
	Binding:          &DetailBinding,
	Graph:            kindspec.ObjectMapGraph{StopsReverseExpansion: true},
}
