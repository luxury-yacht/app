/*
 * backend/resources/endpointslice/identity.go
 *
 * EndpointSlice's built-in resource identity, owned by the kind's package.
 * Declared with the shared resourcekind.Identity type (no resourcecontract import) so resourcecontract can aggregate it.
 */

package endpointslice

import "github.com/luxury-yacht/app/backend/resourcekind"

// Identity is the EndpointSlice built-in resource identity.
var Identity = resourcekind.Identity{
	Group:      "discovery.k8s.io",
	Version:    "v1",
	Kind:       "EndpointSlice",
	Resource:   "endpointslices",
	Namespaced: true,
}
