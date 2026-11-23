package apiextensions

import "github.com/luxury-yacht/app/backend/kind/kindspec"

// Descriptor(s) register apiextensions's kind(s) in the single kind registry
// (kind/kindregistry.All): the canonical Identity plus the facets every
// subsystem reads. This is the one place apiextensions hands itself to the app.

// CustomResourceDefinition has no Stream descriptor: no table lists definitions
// themselves. API Resources lists the kinds they define, so that is where a
// definition is shown in a list. The system wires its owned reflector
// separately (registerCustomResourceDefinitionReflector).
var Descriptor = kindspec.Descriptor{
	Identity:        Identity,
	Display:         kindspec.Display{ShortName: "crd"},
	DetailCacheable: true,
	ListDomain:      "cluster-api-resources",
	Panel:           kindspec.ObjectPanel{ExplainDefinedKind: true},
}
