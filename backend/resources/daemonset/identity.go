/*
 * backend/resources/daemonset/identity.go
 *
 * DaemonSet's built-in resource identity, owned by the kind's package.
 * Declared with the shared resourcekind.Identity type (no resourcecontract import) so resourcecontract can aggregate it.
 */

package daemonset

import "github.com/luxury-yacht/app/backend/resourcekind"

// Identity is the DaemonSet built-in resource identity.
var Identity = resourcekind.Identity{
	Group:      "apps",
	Version:    "v1",
	Kind:       "DaemonSet",
	Resource:   "daemonsets",
	Namespaced: true,
}
