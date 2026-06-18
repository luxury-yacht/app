/*
 * backend/resources/ingressclass/identity.go
 *
 * IngressClass's built-in resource identity, owned by the kind's package.
 * Declared with the shared resourcekind.Identity type (no resourcecontract import) so resourcecontract can aggregate it.
 */

package ingressclass

import "github.com/luxury-yacht/app/backend/resourcekind"

// Identity is the IngressClass built-in resource identity (cluster-scoped).
var Identity = resourcekind.Identity{
	Group:      "networking.k8s.io",
	Version:    "v1",
	Kind:       "IngressClass",
	Resource:   "ingressclasses",
	Namespaced: false,
}
