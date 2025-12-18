package backend

import "github.com/luxury-yacht/app/backend/resources/network"

func (a *App) GetService(namespace, name string) (*ServiceDetails, error) {
	deps := network.Dependencies{Common: a.resourceDependencies()}
	return FetchNamespacedResource(a, "Service", namespace, name, func() (*ServiceDetails, error) {
		return network.NewService(deps).GetService(namespace, name)
	})
}

func (a *App) GetEndpointSlice(namespace, name string) (*EndpointSliceDetails, error) {
	deps := network.Dependencies{Common: a.resourceDependencies()}
	return FetchNamespacedResource(a, "EndpointSlice", namespace, name, func() (*EndpointSliceDetails, error) {
		return network.NewService(deps).EndpointSlice(namespace, name)
	})
}

func (a *App) GetIngress(namespace, name string) (*IngressDetails, error) {
	deps := network.Dependencies{Common: a.resourceDependencies()}
	return FetchNamespacedResource(a, "Ingress", namespace, name, func() (*IngressDetails, error) {
		return network.NewService(deps).Ingress(namespace, name)
	})
}

func (a *App) GetIngressClass(name string) (*IngressClassDetails, error) {
	deps := network.Dependencies{Common: a.resourceDependencies()}
	return FetchClusterResource(a, "IngressClass", name, func() (*IngressClassDetails, error) {
		return network.NewService(deps).IngressClass(name)
	})
}

func (a *App) GetNetworkPolicy(namespace, name string) (*NetworkPolicyDetails, error) {
	deps := network.Dependencies{Common: a.resourceDependencies()}
	return FetchNamespacedResource(a, "NetworkPolicy", namespace, name, func() (*NetworkPolicyDetails, error) {
		return network.NewService(deps).NetworkPolicy(namespace, name)
	})
}
