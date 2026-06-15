/*
 * backend/resources/networkpolicy/identity.go
 *
 * NetworkPolicy's built-in resource identity, owned by the kind's package.
 * Plain struct (no resourcecontract import) so resourcecontract can aggregate it.
 */

package networkpolicy

// Identity is the NetworkPolicy built-in resource identity.
var Identity = struct {
	Group      string
	Version    string
	Kind       string
	Resource   string
	Namespaced bool
}{
	Group:      "networking.k8s.io",
	Version:    "v1",
	Kind:       "NetworkPolicy",
	Resource:   "networkpolicies",
	Namespaced: true,
}
