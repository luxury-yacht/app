/*
 * backend/resources/persistentvolume/identity.go
 *
 * PersistentVolume's built-in resource identity, owned by the kind's package.
 */

package persistentvolume

// Identity is the PersistentVolume built-in resource identity (cluster-scoped).
var Identity = struct {
	Group      string
	Version    string
	Kind       string
	Resource   string
	Namespaced bool
}{
	Group:      "",
	Version:    "v1",
	Kind:       "PersistentVolume",
	Resource:   "persistentvolumes",
	Namespaced: false,
}
