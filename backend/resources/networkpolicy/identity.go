/*
 * backend/resources/networkpolicy/identity.go
 *
 * NetworkPolicy's built-in resource identity, owned by the kind's package.
 * Declared with the shared resourcekind.Identity type (no resourcecontract import) so resourcecontract can aggregate it.
 */

package networkpolicy

import "github.com/luxury-yacht/app/backend/resourcekind"

// Identity is the NetworkPolicy built-in resource identity.
var Identity = resourcekind.Identity{
	Group:      "networking.k8s.io",
	Version:    "v1",
	Kind:       "NetworkPolicy",
	Resource:   "networkpolicies",
	Namespaced: true,
}
