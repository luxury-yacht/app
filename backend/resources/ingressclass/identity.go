/*
 * backend/resources/ingressclass/identity.go
 *
 * IngressClass's built-in resource identity, owned by the kind's package.
 * Plain struct (no resourcecontract import) so resourcecontract can aggregate it.
 */

package ingressclass

// Identity is the IngressClass built-in resource identity (cluster-scoped).
var Identity = struct {
	Group      string
	Version    string
	Kind       string
	Resource   string
	Namespaced bool
}{
	Group:      "networking.k8s.io",
	Version:    "v1",
	Kind:       "IngressClass",
	Resource:   "ingressclasses",
	Namespaced: false,
}
