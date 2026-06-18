/*
 * backend/resources/resourcequota/identity.go
 *
 * ResourceQuota's built-in resource identity, owned by the kind's package.
 */

package resourcequota

import "github.com/luxury-yacht/app/backend/resourcekind"

// Identity is the ResourceQuota built-in resource identity.
var Identity = resourcekind.Identity{
	Group:      "",
	Version:    "v1",
	Kind:       "ResourceQuota",
	Resource:   "resourcequotas",
	Namespaced: true,
}
