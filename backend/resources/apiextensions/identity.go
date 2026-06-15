/*
 * backend/resources/apiextensions/identity.go
 *
 * CustomResourceDefinition's built-in resource identity, owned by the kind's
 * package (apiextensions is CRD's only kind). Plain struct (no resourcecontract
 * import) so resourcecontract can aggregate it.
 */

package apiextensions

// Identity is the CustomResourceDefinition built-in resource identity (cluster-scoped).
var Identity = struct {
	Group      string
	Version    string
	Kind       string
	Resource   string
	Namespaced bool
}{
	Group:      "apiextensions.k8s.io",
	Version:    "v1",
	Kind:       "CustomResourceDefinition",
	Resource:   "customresourcedefinitions",
	Namespaced: false,
}
