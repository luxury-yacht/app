/*
 * backend/resources/endpointslice/identity.go
 *
 * EndpointSlice's built-in resource identity, owned by the kind's package.
 * Plain struct (no resourcecontract import) so resourcecontract can aggregate it.
 */

package endpointslice

// Identity is the EndpointSlice built-in resource identity.
var Identity = struct {
	Group      string
	Version    string
	Kind       string
	Resource   string
	Namespaced bool
}{
	Group:      "discovery.k8s.io",
	Version:    "v1",
	Kind:       "EndpointSlice",
	Resource:   "endpointslices",
	Namespaced: true,
}
