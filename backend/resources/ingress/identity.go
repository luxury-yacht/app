/*
 * backend/resources/ingress/identity.go
 *
 * Ingress's built-in resource identity, owned by the kind's package.
 * Plain struct (no resourcecontract import) so resourcecontract can aggregate it.
 */

package ingress

// Identity is the Ingress built-in resource identity (namespaced).
var Identity = struct {
	Group      string
	Version    string
	Kind       string
	Resource   string
	Namespaced bool
}{
	Group:      "networking.k8s.io",
	Version:    "v1",
	Kind:       "Ingress",
	Resource:   "ingresses",
	Namespaced: true,
}
