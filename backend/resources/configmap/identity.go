/*
 * backend/resources/configmap/identity.go
 *
 * ConfigMap's built-in resource identity, owned by the kind's package.
 * Declared with the shared resourcekind.Identity type (no resourcecontract import) so resourcecontract can aggregate it.
 */

package configmap

import "github.com/luxury-yacht/app/backend/resourcekind"

// Identity is the ConfigMap built-in resource identity.
var Identity = resourcekind.Identity{
	Group:      "",
	Version:    "v1",
	Kind:       "ConfigMap",
	Resource:   "configmaps",
	Namespaced: true,
}
