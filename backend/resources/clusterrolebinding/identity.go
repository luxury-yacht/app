/*
 * backend/resources/clusterrolebinding/identity.go
 *
 * ClusterRoleBinding's built-in resource identity, owned by the kind's package.
 * Declared with the shared resourcekind.Identity type (no resourcecontract import) so resourcecontract can aggregate it.
 */

package clusterrolebinding

import "github.com/luxury-yacht/app/backend/resourcekind"

// Identity is the ClusterRoleBinding built-in resource identity (cluster-scoped).
var Identity = resourcekind.Identity{
	Group:      "rbac.authorization.k8s.io",
	Version:    "v1",
	Kind:       "ClusterRoleBinding",
	Resource:   "clusterrolebindings",
	Namespaced: false,
}
