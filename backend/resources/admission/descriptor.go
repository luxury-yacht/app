package admission

import "github.com/luxury-yacht/app/backend/kind/kindspec"

// Descriptor(s) register admission's kind(s) in the single kind registry
// (kind/kindregistry.All): the canonical Identity plus the facets every
// subsystem reads. This is the one place admission hands itself to the app.

var MutatingDescriptor = kindspec.Descriptor{
	Identity:        MutatingIdentity,
	CatalogSource:   kindspec.CatalogDynamic,
	DetailCacheable: true,
	IngestOwned:     true,
	Stream:          &MutatingStreamDescriptor,
	Binding:         &MutatingDetailBinding,
}

var ValidatingDescriptor = kindspec.Descriptor{
	Identity:        ValidatingIdentity,
	CatalogSource:   kindspec.CatalogDynamic,
	DetailCacheable: true,
	IngestOwned:     true,
	Stream:          &ValidatingStreamDescriptor,
	Binding:         &ValidatingDetailBinding,
}
