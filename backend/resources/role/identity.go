/*
 * backend/resources/role/identity.go
 *
 * Role's built-in resource identity, owned by the kind's package.
 * Declared with the shared resourcekind.Identity type (no resourcecontract import) so resourcecontract can aggregate it.
 */

package role

import "github.com/luxury-yacht/app/backend/resourcekind"

// Identity is the Role built-in resource identity (namespaced).
var Identity = resourcekind.Identity{
	Group:      "rbac.authorization.k8s.io",
	Version:    "v1",
	Kind:       "Role",
	Resource:   "roles",
	Namespaced: true,
}
