package events

import "github.com/luxury-yacht/app/backend/kind/kindspec"

// Descriptor registers Event's owned reflector, detail binding, and cache
// invalidation without collecting high-churn Event objects into the general
// object catalog.
var Descriptor = kindspec.Descriptor{
	Identity:        Identity,
	ListDomain:      "namespace-events",
	Display:         kindspec.Display{ShortName: "ev"},
	CatalogSource:   kindspec.CatalogNone,
	DetailCacheable: true,
	Binding:         &DetailBinding,
	Panel:           kindspec.ObjectPanel{HideEvents: true, HideYAML: true},
}
