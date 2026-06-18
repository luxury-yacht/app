/*
 * backend/resources/persistentvolume/identity.go
 *
 * PersistentVolume's built-in resource identity, owned by the kind's package.
 */

package persistentvolume

import "github.com/luxury-yacht/app/backend/resourcekind"

// Identity is the PersistentVolume built-in resource identity (cluster-scoped).
var Identity = resourcekind.Identity{
	Group:      "",
	Version:    "v1",
	Kind:       "PersistentVolume",
	Resource:   "persistentvolumes",
	Namespaced: false,
}
