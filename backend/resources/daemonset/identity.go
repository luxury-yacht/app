/*
 * backend/resources/daemonset/identity.go
 *
 * DaemonSet's built-in resource identity, owned by the kind's package.
 * Plain struct (no resourcecontract import) so resourcecontract can aggregate it.
 */

package daemonset

// Identity is the DaemonSet built-in resource identity.
var Identity = struct {
	Group      string
	Version    string
	Kind       string
	Resource   string
	Namespaced bool
}{
	Group:      "apps",
	Version:    "v1",
	Kind:       "DaemonSet",
	Resource:   "daemonsets",
	Namespaced: true,
}
