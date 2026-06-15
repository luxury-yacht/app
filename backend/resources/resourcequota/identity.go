/*
 * backend/resources/resourcequota/identity.go
 *
 * ResourceQuota's built-in resource identity, owned by the kind's package.
 */

package resourcequota

// Identity is the ResourceQuota built-in resource identity.
var Identity = struct {
	Group      string
	Version    string
	Kind       string
	Resource   string
	Namespaced bool
}{
	Group:      "",
	Version:    "v1",
	Kind:       "ResourceQuota",
	Resource:   "resourcequotas",
	Namespaced: true,
}
