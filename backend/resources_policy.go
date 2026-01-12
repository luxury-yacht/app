/*
 * backend/resources_policy.go
 *
 * App-level policy resource wrappers.
 * - Exposes PodDisruptionBudget handlers.
 */

package backend

import "github.com/luxury-yacht/app/backend/resources/policy"

func (a *App) GetPodDisruptionBudget(namespace, name string) (*PodDisruptionBudgetDetails, error) {
	deps := a.resourceDependencies()
	return FetchNamespacedResource(a, "PodDisruptionBudget", namespace, name, func() (*PodDisruptionBudgetDetails, error) {
		return policy.NewService(deps).PodDisruptionBudget(namespace, name)
	})
}
