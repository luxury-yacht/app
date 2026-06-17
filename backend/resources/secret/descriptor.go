package secret

import "github.com/luxury-yacht/app/backend/refresh/kindspec"

// Descriptor(s) register secret's kind(s) in the single kind registry
// (refresh/kindregistry.All): the canonical Identity plus the facets every
// subsystem reads. This is the one place secret hands itself to the app.

var Descriptor = kindspec.Descriptor{
	Identity:        Identity,
	CatalogSource:   kindspec.CatalogShared,
	DetailCacheable: true,
	Stream:          &StreamDescriptor,
	Collector:       &ObjectMapNode,
	Binding:         &DetailBinding,
	Graph:           kindspec.ObjectMapGraph{DirectionalTraversal: true},
}
