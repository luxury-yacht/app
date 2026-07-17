package events

import "github.com/luxury-yacht/app/backend/kind/kindspec"

// Descriptor registers Event's detail binding and cache invalidation without
// collecting high-churn Event objects into the general object catalog.
var Descriptor = kindspec.Descriptor{
	Identity:        Identity,
	CatalogSource:   kindspec.CatalogNone,
	DetailCacheable: true,
	Binding:         &DetailBinding,
}
