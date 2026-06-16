/*
 * backend/resources/poddisruptionbudget/identity.go
 *
 * PodDisruptionBudget's built-in resource identity, owned by the kind's package.
 * Declared with the shared resourcekind.Identity type (no resourcecontract import) so resourcecontract can aggregate it.
 */

package poddisruptionbudget

import "github.com/luxury-yacht/app/backend/resourcekind"

// Identity is the PodDisruptionBudget built-in resource identity.
var Identity = resourcekind.Identity{
	Group:      "policy",
	Version:    "v1",
	Kind:       "PodDisruptionBudget",
	Resource:   "poddisruptionbudgets",
	Namespaced: true,
}
