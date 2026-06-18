package grpcroute

import "github.com/luxury-yacht/app/backend/kind/kindspec"

// Descriptor(s) register grpcroute's kind(s) in the single kind registry
// (refresh/kindregistry.All): the canonical Identity plus the facets every
// subsystem reads. This is the one place grpcroute hands itself to the app.

var Descriptor = kindspec.Descriptor{
	Identity:         Identity,
	CatalogSource:    kindspec.CatalogGateway,
	DetailCacheable:  true,
	Stream:           &StreamDescriptor,
	GatewayCollector: &ObjectMapNode,
	Edges:            ObjectMapEdges,
	Binding:          &DetailBinding,
}
