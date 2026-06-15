/*
 * backend/resources/nodes/identity.go
 *
 * Node's built-in resource identity, owned by the kind's package.
 * Plain struct (no resourcecontract import) so resourcecontract can aggregate it.
 */

package nodes

// Identity is the Node built-in resource identity (cluster-scoped, core group).
var Identity = struct {
	Group      string
	Version    string
	Kind       string
	Resource   string
	Namespaced bool
}{
	Group:      "",
	Version:    "v1",
	Kind:       "Node",
	Resource:   "nodes",
	Namespaced: false,
}
