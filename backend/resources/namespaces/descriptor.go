package namespaces

import "github.com/luxury-yacht/app/backend/refresh/kindspec"

// Descriptor(s) register namespaces's kind(s) in the single kind registry
// (refresh/kindregistry.All): the canonical Identity plus the facets every
// subsystem reads. This is the one place namespaces hands itself to the app.

var Descriptor = kindspec.Descriptor{
	Identity:        Identity,
	CatalogSource:   kindspec.CatalogShared,
	DetailCacheable: true,
	Binding:         &DetailBinding,
}
