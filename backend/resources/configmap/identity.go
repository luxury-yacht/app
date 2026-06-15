/*
 * backend/resources/configmap/identity.go
 *
 * ConfigMap's built-in resource identity, owned by the kind's package.
 * Plain struct (no resourcecontract import) so resourcecontract can aggregate it.
 */

package configmap

// Identity is the ConfigMap built-in resource identity.
var Identity = struct {
	Group      string
	Version    string
	Kind       string
	Resource   string
	Namespaced bool
}{
	Group:      "",
	Version:    "v1",
	Kind:       "ConfigMap",
	Resource:   "configmaps",
	Namespaced: true,
}
