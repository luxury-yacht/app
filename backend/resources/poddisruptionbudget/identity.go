/*
 * backend/resources/poddisruptionbudget/identity.go
 *
 * PodDisruptionBudget's built-in resource identity, owned by the kind's package.
 * Plain struct (no resourcecontract import) so resourcecontract can aggregate it.
 */

package poddisruptionbudget

// Identity is the PodDisruptionBudget built-in resource identity.
var Identity = struct {
	Group      string
	Version    string
	Kind       string
	Resource   string
	Namespaced bool
}{
	Group:      "policy",
	Version:    "v1",
	Kind:       "PodDisruptionBudget",
	Resource:   "poddisruptionbudgets",
	Namespaced: true,
}
