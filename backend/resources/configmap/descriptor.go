package configmap

import "github.com/luxury-yacht/app/backend/kind/kindspec"

// Descriptor(s) register configmap's kind(s) in the single kind registry
// (kind/kindregistry.All): the canonical Identity plus the facets every
// subsystem reads. This is the one place configmap hands itself to the app.

var Descriptor = kindspec.Descriptor{
	Identity:        Identity,
	CatalogSource:   kindspec.CatalogShared,
	DetailCacheable: true,
	IngestOwned:     true,
	Stream:          &StreamDescriptor,
	Collector:       &ObjectMapNode,
	Binding:         &DetailBinding,
	Graph:           kindspec.ObjectMapGraph{DirectionalTraversal: true},
}
