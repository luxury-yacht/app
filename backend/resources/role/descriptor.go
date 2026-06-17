package role

import "github.com/luxury-yacht/app/backend/refresh/kindspec"

// Descriptor(s) register role's kind(s) in the single kind registry
// (refresh/kindregistry.All): the canonical Identity plus the facets every
// subsystem reads. This is the one place role hands itself to the app.

var Descriptor = kindspec.Descriptor{
	Identity:        Identity,
	CatalogSource:   kindspec.CatalogShared,
	DetailCacheable: true,
	Stream:          &StreamDescriptor,
	Binding:         &DetailBinding,
}
