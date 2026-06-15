/*
 * backend/resources/secret/identity.go
 *
 * Secret's built-in resource identity, owned by the kind's package.
 * Plain struct (no resourcecontract import) so resourcecontract can aggregate it.
 */

package secret

// Identity is the Secret built-in resource identity.
var Identity = struct {
	Group      string
	Version    string
	Kind       string
	Resource   string
	Namespaced bool
}{
	Group:      "",
	Version:    "v1",
	Kind:       "Secret",
	Resource:   "secrets",
	Namespaced: true,
}
