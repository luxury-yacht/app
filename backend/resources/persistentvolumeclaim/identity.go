/*
 * backend/resources/persistentvolumeclaim/identity.go
 *
 * PersistentVolumeClaim's built-in resource identity, owned by the kind's package.
 */

package persistentvolumeclaim

import "github.com/luxury-yacht/app/backend/resourcekind"

// Identity is the PersistentVolumeClaim built-in resource identity.
var Identity = resourcekind.Identity{
	Group:      "",
	Version:    "v1",
	Kind:       "PersistentVolumeClaim",
	Resource:   "persistentvolumeclaims",
	Namespaced: true,
}
