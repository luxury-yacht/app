/*
 * backend/resources/storageclass/identity.go
 *
 * StorageClass's built-in resource identity, owned by the kind's package.
 * Declared with the shared resourcekind.Identity type (no resourcecontract import) so resourcecontract can aggregate it.
 */

package storageclass

import "github.com/luxury-yacht/app/backend/resourcekind"

// Identity is the StorageClass built-in resource identity (cluster-scoped).
var Identity = resourcekind.Identity{
	Group:      "storage.k8s.io",
	Version:    "v1",
	Kind:       "StorageClass",
	Resource:   "storageclasses",
	Namespaced: false,
}
