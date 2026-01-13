/*
 * backend/resources_policy.go
 *
 * App-level policy resource wrappers.
 * - Exposes PodDisruptionBudget handlers.
 */

package backend

import "github.com/luxury-yacht/app/backend/resources/policy"

func (a *App) GetPodDisruptionBudget(clusterID, namespace, name string) (*PodDisruptionBudgetDetails, error) {
	deps, selectionKey, err := a.resolveClusterDependencies(clusterID)
	if err != nil {
		return nil, err
	}
	return FetchNamespacedResource(a, deps, selectionKey, "PodDisruptionBudget", namespace, name, func() (*PodDisruptionBudgetDetails, error) {
		return policy.NewService(deps).PodDisruptionBudget(namespace, name)
	})
}
