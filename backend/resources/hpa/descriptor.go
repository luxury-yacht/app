package hpa

import "github.com/luxury-yacht/app/backend/kind/kindspec"

// Descriptor(s) register hpa's kind(s) in the single kind registry
// (refresh/kindregistry.All): the canonical Identity plus the facets every
// subsystem reads. This is the one place hpa hands itself to the app.

var Descriptor = kindspec.Descriptor{
	Identity:        IdentityV1,
	CatalogSource:   kindspec.CatalogShared,
	DetailCacheable: true,
	Stream:          &StreamDescriptor,
	Edges:           ObjectMapEdges,
	Binding:         &DetailBinding,
}
