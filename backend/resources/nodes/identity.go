/*
 * backend/resources/nodes/identity.go
 *
 * Node's built-in resource identity, owned by the kind's package.
 * Declared with the shared resourcekind.Identity type (no resourcecontract import) so resourcecontract can aggregate it.
 */

package nodes

import "github.com/luxury-yacht/app/backend/resourcekind"

// Identity is the Node built-in resource identity (cluster-scoped, core group).
var Identity = resourcekind.Identity{
	Group:      "",
	Version:    "v1",
	Kind:       "Node",
	Resource:   "nodes",
	Namespaced: false,
}
