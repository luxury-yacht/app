package apiextensions

import "github.com/luxury-yacht/app/backend/kind/kindspec"

// Descriptor(s) register apiextensions's kind(s) in the single kind registry
// (refresh/kindregistry.All): the canonical Identity plus the facets every
// subsystem reads. This is the one place apiextensions hands itself to the app.

var Descriptor = kindspec.Descriptor{
	Identity:        Identity,
	CatalogSource:   kindspec.CatalogAPIExtensions,
	DetailCacheable: true,
}
