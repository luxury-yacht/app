package clusterrole

import "github.com/luxury-yacht/app/backend/resources/appbinding"

// DetailBinding declares this kind's App.Get binding for the genappbindings
// generator, which aggregates every kind's Spec to emit the wrappers.
var DetailBinding = appbinding.Spec{
	Identity: Identity,
	Service:  "clusterrole.NewService(deps)",
	Import:   "github.com/luxury-yacht/app/backend/resources/clusterrole",
}
