/*
 * backend/resources/role/identity.go
 *
 * Role's built-in resource identity, owned by the kind's package.
 * Plain struct (no resourcecontract import) so resourcecontract can aggregate it.
 */

package role

// Identity is the Role built-in resource identity (namespaced).
var Identity = struct {
	Group      string
	Version    string
	Kind       string
	Resource   string
	Namespaced bool
}{
	Group:      "rbac.authorization.k8s.io",
	Version:    "v1",
	Kind:       "Role",
	Resource:   "roles",
	Namespaced: true,
}
