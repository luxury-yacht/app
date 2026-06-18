package ingress

import "github.com/luxury-yacht/app/backend/kind/kindspec"

// Descriptor(s) register ingress's kind(s) in the single kind registry
// (refresh/kindregistry.All): the canonical Identity plus the facets every
// subsystem reads. This is the one place ingress hands itself to the app.

var Descriptor = kindspec.Descriptor{
	Identity:        Identity,
	CatalogSource:   kindspec.CatalogShared,
	DetailCacheable: true,
	Stream:          &StreamDescriptor,
	Collector:       &ObjectMapNode,
	Edges:           ObjectMapEdges,
	Binding:         &DetailBinding,
}
