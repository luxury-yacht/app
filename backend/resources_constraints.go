package backend

import "github.com/luxury-yacht/app/backend/resources/constraints"

func (a *App) GetLimitRange(namespace, name string) (*LimitRangeDetails, error) {
	deps := a.resourceDependencies()
	return FetchNamespacedResource(a, "LimitRange", namespace, name, func() (*LimitRangeDetails, error) {
		return constraints.NewService(deps).LimitRange(namespace, name)
	})
}

func (a *App) GetResourceQuota(namespace, name string) (*ResourceQuotaDetails, error) {
	deps := a.resourceDependencies()
	return FetchNamespacedResource(a, "ResourceQuota", namespace, name, func() (*ResourceQuotaDetails, error) {
		return constraints.NewService(deps).ResourceQuota(namespace, name)
	})
}
