/*
 * backend/resources/replicaset/identity.go
 *
 * ReplicaSet's built-in resource identity, owned by the kind's package.
 * Declared with the shared resourcekind.Identity type (no resourcecontract import) so resourcecontract can aggregate it.
 */

package replicaset

import "github.com/luxury-yacht/app/backend/resourcekind"

// Identity is the ReplicaSet built-in resource identity.
var Identity = resourcekind.Identity{
	Group:      "apps",
	Version:    "v1",
	Kind:       "ReplicaSet",
	Resource:   "replicasets",
	Namespaced: true,
}
