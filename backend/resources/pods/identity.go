/*
 * backend/resources/pods/identity.go
 *
 * Pod's built-in resource identity, owned by the kind's package. Declared with
 * the shared resourcekind.Identity type (no resourcecontract import) so
 * resourcecontract can aggregate it.
 */

package pods

import "github.com/luxury-yacht/app/backend/resourcekind"

// Identity is the Pod built-in resource identity (namespaced, core group).
var Identity = resourcekind.Identity{
	Group:      "",
	Version:    "v1",
	Kind:       "Pod",
	Resource:   "pods",
	Namespaced: true,
}
