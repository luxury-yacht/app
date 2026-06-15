/*
 * backend/resources/service/identity.go
 *
 * Service's built-in resource identity, owned by the kind's package.
 * Plain struct (no resourcecontract import) so resourcecontract can aggregate it.
 */

package service

// Identity is the Service built-in resource identity (namespaced, core group).
var Identity = struct {
	Group      string
	Version    string
	Kind       string
	Resource   string
	Namespaced bool
}{
	Group:      "",
	Version:    "v1",
	Kind:       "Service",
	Resource:   "services",
	Namespaced: true,
}
