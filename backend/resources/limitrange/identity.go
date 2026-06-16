/*
 * backend/resources/limitrange/identity.go
 *
 * LimitRange's built-in resource identity, owned by the kind's package.
 */

package limitrange

import "github.com/luxury-yacht/app/backend/resourcekind"

// Identity is the LimitRange built-in resource identity.
var Identity = resourcekind.Identity{
	Group:      "",
	Version:    "v1",
	Kind:       "LimitRange",
	Resource:   "limitranges",
	Namespaced: true,
}
