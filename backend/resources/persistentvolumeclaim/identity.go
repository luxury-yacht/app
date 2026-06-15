/*
 * backend/resources/persistentvolumeclaim/identity.go
 *
 * PersistentVolumeClaim's built-in resource identity, owned by the kind's package.
 */

package persistentvolumeclaim

// Identity is the PersistentVolumeClaim built-in resource identity.
var Identity = struct {
	Group      string
	Version    string
	Kind       string
	Resource   string
	Namespaced bool
}{
	Group:      "",
	Version:    "v1",
	Kind:       "PersistentVolumeClaim",
	Resource:   "persistentvolumeclaims",
	Namespaced: true,
}
