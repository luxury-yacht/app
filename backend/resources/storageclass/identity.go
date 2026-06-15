/*
 * backend/resources/storageclass/identity.go
 *
 * StorageClass's built-in resource identity, owned by the kind's package.
 * Plain struct (no resourcecontract import) so resourcecontract can aggregate it.
 */

package storageclass

// Identity is the StorageClass built-in resource identity (cluster-scoped).
var Identity = struct {
	Group      string
	Version    string
	Kind       string
	Resource   string
	Namespaced bool
}{
	Group:      "storage.k8s.io",
	Version:    "v1",
	Kind:       "StorageClass",
	Resource:   "storageclasses",
	Namespaced: false,
}
