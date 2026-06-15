/*
 * backend/resources/replicaset/identity.go
 *
 * ReplicaSet's built-in resource identity, owned by the kind's package.
 * Plain struct (no resourcecontract import) so resourcecontract can aggregate it.
 */

package replicaset

// Identity is the ReplicaSet built-in resource identity.
var Identity = struct {
	Group      string
	Version    string
	Kind       string
	Resource   string
	Namespaced bool
}{
	Group:      "apps",
	Version:    "v1",
	Kind:       "ReplicaSet",
	Resource:   "replicasets",
	Namespaced: true,
}
