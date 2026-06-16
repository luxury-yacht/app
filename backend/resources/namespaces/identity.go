/*
 * backend/resources/namespaces/identity.go
 *
 * Namespace's built-in resource identity, owned by the kind's package.
 * Declared with the shared resourcekind.Identity type (no resourcecontract import) so resourcecontract can aggregate it.
 */

package namespaces

import "github.com/luxury-yacht/app/backend/resourcekind"

// Identity is the Namespace built-in resource identity (cluster-scoped, core group).
var Identity = resourcekind.Identity{
	Group:      "",
	Version:    "v1",
	Kind:       "Namespace",
	Resource:   "namespaces",
	Namespaced: false,
}
