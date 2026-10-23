package namespaces

import "github.com/luxury-yacht/app/backend/kind/kindspec"

// Descriptor(s) register namespaces's kind(s) in the single kind registry
// (kind/kindregistry.All): the canonical Identity plus the facets every
// subsystem reads. This is the one place namespaces hands itself to the app.

var Descriptor = kindspec.Descriptor{
	Identity:        Identity,
	ListDomain:      "namespaces",
	Display:         kindspec.Display{ShortName: "ns"},
	DetailCacheable: true,
	Binding:         &DetailBinding,
	Actions:         kindspec.ObjectActions{NamespaceFinalizer: true},
}
