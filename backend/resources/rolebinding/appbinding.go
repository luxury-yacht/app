package rolebinding

import "github.com/luxury-yacht/app/backend/resources/appbinding"

// DetailBinding declares this kind's App.Get binding for the genappbindings
// generator, which aggregates every kind's Spec to emit the wrappers.
var DetailBinding = appbinding.Spec{
	Identity: Identity,
	Service:  "rolebinding.NewService(deps)",
	Import:   "github.com/luxury-yacht/app/backend/resources/rolebinding",
}
