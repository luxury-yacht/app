package clusterrole

import "github.com/luxury-yacht/app/backend/resources/appbinding"

// DetailBinding declares this kind's typed detail fetch for the genappbindings
// generator, which aggregates every kind's Spec into the detail-fetcher map.
var DetailBinding = appbinding.Spec{
	Identity: Identity,
	Service:  "clusterrole.NewService(deps)",
	Import:   "github.com/luxury-yacht/app/backend/resources/clusterrole",
}
