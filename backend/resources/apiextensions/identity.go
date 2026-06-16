/*
 * backend/resources/apiextensions/identity.go
 *
 * CustomResourceDefinition's built-in resource identity, owned by the kind's
 * package (apiextensions is CRD's only kind). Declared with the shared
 * resourcekind.Identity type (no resourcecontract import) so resourcecontract
 * can aggregate it.
 */

package apiextensions

import "github.com/luxury-yacht/app/backend/resourcekind"

// Identity is the CustomResourceDefinition built-in resource identity (cluster-scoped).
var Identity = resourcekind.Identity{
	Group:      "apiextensions.k8s.io",
	Version:    "v1",
	Kind:       "CustomResourceDefinition",
	Resource:   "customresourcedefinitions",
	Namespaced: false,
}
