/*
 * backend/resources/clusterrole/identity.go
 *
 * ClusterRole's built-in resource identity, owned by the kind's package.
 * Declared with the shared resourcekind.Identity type (no resourcecontract import) so resourcecontract can aggregate it.
 */

package clusterrole

import "github.com/luxury-yacht/app/backend/resourcekind"

// Identity is the ClusterRole built-in resource identity (cluster-scoped).
var Identity = resourcekind.Identity{
	Group:      "rbac.authorization.k8s.io",
	Version:    "v1",
	Kind:       "ClusterRole",
	Resource:   "clusterroles",
	Namespaced: false,
}
