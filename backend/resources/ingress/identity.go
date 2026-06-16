/*
 * backend/resources/ingress/identity.go
 *
 * Ingress's built-in resource identity, owned by the kind's package.
 * Declared with the shared resourcekind.Identity type (no resourcecontract import) so resourcecontract can aggregate it.
 */

package ingress

import "github.com/luxury-yacht/app/backend/resourcekind"

// Identity is the Ingress built-in resource identity (namespaced).
var Identity = resourcekind.Identity{
	Group:      "networking.k8s.io",
	Version:    "v1",
	Kind:       "Ingress",
	Resource:   "ingresses",
	Namespaced: true,
}
