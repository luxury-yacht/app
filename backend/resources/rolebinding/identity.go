/*
 * backend/resources/rolebinding/identity.go
 *
 * RoleBinding's built-in resource identity, owned by the kind's package.
 * Declared with the shared resourcekind.Identity type (no resourcecontract import) so resourcecontract can aggregate it.
 */

package rolebinding

import "github.com/luxury-yacht/app/backend/resourcekind"

// Identity is the RoleBinding built-in resource identity (namespaced).
var Identity = resourcekind.Identity{
	Group:      "rbac.authorization.k8s.io",
	Version:    "v1",
	Kind:       "RoleBinding",
	Resource:   "rolebindings",
	Namespaced: true,
}
