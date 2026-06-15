/*
 * backend/resources/clusterrolebinding/identity.go
 *
 * ClusterRoleBinding's built-in resource identity, owned by the kind's package.
 * Plain struct (no resourcecontract import) so resourcecontract can aggregate it.
 */

package clusterrolebinding

// Identity is the ClusterRoleBinding built-in resource identity (cluster-scoped).
var Identity = struct {
	Group      string
	Version    string
	Kind       string
	Resource   string
	Namespaced bool
}{
	Group:      "rbac.authorization.k8s.io",
	Version:    "v1",
	Kind:       "ClusterRoleBinding",
	Resource:   "clusterrolebindings",
	Namespaced: false,
}
