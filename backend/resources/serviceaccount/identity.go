/*
 * backend/resources/serviceaccount/identity.go
 *
 * ServiceAccount's built-in resource identity, owned by the kind's package.
 * Declared with the shared resourcekind.Identity type (no resourcecontract import) so resourcecontract can aggregate it.
 */

package serviceaccount

import "github.com/luxury-yacht/app/backend/resourcekind"

// Identity is the ServiceAccount built-in resource identity (namespaced, core group).
var Identity = resourcekind.Identity{
	Group:      "",
	Version:    "v1",
	Kind:       "ServiceAccount",
	Resource:   "serviceaccounts",
	Namespaced: true,
}
