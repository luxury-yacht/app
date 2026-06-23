package resourcequota

import "github.com/luxury-yacht/app/backend/kind/kindspec"

// Descriptor(s) register resourcequota's kind(s) in the single kind registry
// (kind/kindregistry.All): the canonical Identity plus the facets every
// subsystem reads. This is the one place resourcequota hands itself to the app.

var Descriptor = kindspec.Descriptor{
	Identity:        Identity,
	CatalogSource:   kindspec.CatalogShared,
	DetailCacheable: true,
	IngestOwned:     true,
	Stream:          &StreamDescriptor,
	Binding:         &DetailBinding,
}
