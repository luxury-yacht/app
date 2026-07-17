package events

import "github.com/luxury-yacht/app/backend/resources/appbinding"

// DetailBinding declares Event's typed detail binding. Events are deliberately
// excluded from the object catalog but still use the standard generated binding.
var DetailBinding = appbinding.Spec{
	Identity: Identity,
	Service:  "events.NewService(deps)",
	Import:   "github.com/luxury-yacht/app/backend/resources/events",
}
