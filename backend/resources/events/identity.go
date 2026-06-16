/*
 * backend/resources/events/identity.go
 *
 * Event's built-in resource identity, owned by the kind's package. Declared with
 * the shared resourcekind.Identity type (no resourcecontract import) so
 * resourcecontract can aggregate it.
 */

package events

import "github.com/luxury-yacht/app/backend/resourcekind"

// Identity is the Event built-in resource identity (namespaced, core group).
var Identity = resourcekind.Identity{
	Group:      "",
	Version:    "v1",
	Kind:       "Event",
	Resource:   "events",
	Namespaced: true,
}
