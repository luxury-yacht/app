/*
 * backend/resources/statefulset/identity.go
 *
 * StatefulSet's built-in resource identity, owned by the kind's package. The
 * resourcecontract identity table assembles its rows from each kind's Identity,
 * so the GVK is declared here, once, with the rest of the kind's definition.
 *
 * Intentionally a plain struct (no resourcecontract import) so resourcecontract
 * can import this package to aggregate it without an import cycle.
 */

package statefulset

import "github.com/luxury-yacht/app/backend/resourcekind"

// Identity is the StatefulSet built-in resource identity.
var Identity = resourcekind.Identity{
	Group:      "apps",
	Version:    "v1",
	Kind:       "StatefulSet",
	Resource:   "statefulsets",
	Namespaced: true,
}
