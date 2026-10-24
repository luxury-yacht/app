package tlsroute

import "github.com/luxury-yacht/app/backend/resources/appbinding"

// DetailBinding declares this kind's typed detail fetch for the genappbindings
// generator, which aggregates every kind's Spec into the detail-fetcher map.
var DetailBinding = appbinding.Spec{
	Identity:  Identity,
	Service:   "tlsroute.NewService(deps)",
	Import:    "github.com/luxury-yacht/app/backend/resources/tlsroute",
	DTOImport: "github.com/luxury-yacht/app/backend/resources/types",
}
