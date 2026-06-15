/*
 * backend/resources/clusterrole/identity.go
 *
 * ClusterRole's built-in resource identity, owned by the kind's package.
 * Plain struct (no resourcecontract import) so resourcecontract can aggregate it.
 */

package clusterrole

// Identity is the ClusterRole built-in resource identity (cluster-scoped).
var Identity = struct {
	Group      string
	Version    string
	Kind       string
	Resource   string
	Namespaced bool
}{
	Group:      "rbac.authorization.k8s.io",
	Version:    "v1",
	Kind:       "ClusterRole",
	Resource:   "clusterroles",
	Namespaced: false,
}
