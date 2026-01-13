/*
 * backend/resources_constraints.go
 *
 * App-level constraint resource wrappers.
 * - Exposes LimitRange and ResourceQuota handlers.
 */

package backend

import "github.com/luxury-yacht/app/backend/resources/constraints"

func (a *App) GetLimitRange(clusterID, namespace, name string) (*LimitRangeDetails, error) {
	deps, selectionKey, err := a.resolveClusterDependencies(clusterID)
	if err != nil {
		return nil, err
	}
	return FetchNamespacedResource(a, deps, selectionKey, "LimitRange", namespace, name, func() (*LimitRangeDetails, error) {
		return constraints.NewService(deps).LimitRange(namespace, name)
	})
}

func (a *App) GetResourceQuota(clusterID, namespace, name string) (*ResourceQuotaDetails, error) {
	deps, selectionKey, err := a.resolveClusterDependencies(clusterID)
	if err != nil {
		return nil, err
	}
	return FetchNamespacedResource(a, deps, selectionKey, "ResourceQuota", namespace, name, func() (*ResourceQuotaDetails, error) {
		return constraints.NewService(deps).ResourceQuota(namespace, name)
	})
}
