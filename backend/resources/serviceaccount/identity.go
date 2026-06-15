/*
 * backend/resources/serviceaccount/identity.go
 *
 * ServiceAccount's built-in resource identity, owned by the kind's package.
 * Plain struct (no resourcecontract import) so resourcecontract can aggregate it.
 */

package serviceaccount

// Identity is the ServiceAccount built-in resource identity (namespaced, core group).
var Identity = struct {
	Group      string
	Version    string
	Kind       string
	Resource   string
	Namespaced bool
}{
	Group:      "",
	Version:    "v1",
	Kind:       "ServiceAccount",
	Resource:   "serviceaccounts",
	Namespaced: true,
}
