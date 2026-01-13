/*
 * backend/resources_network.go
 *
 * App-level network resource wrappers.
 * - Exposes Service, Ingress, EndpointSlice, and NetworkPolicy handlers.
 */

package backend

import "github.com/luxury-yacht/app/backend/resources/network"

func (a *App) GetService(clusterID, namespace, name string) (*ServiceDetails, error) {
	deps, selectionKey, err := a.resolveClusterDependencies(clusterID)
	if err != nil {
		return nil, err
	}
	return FetchNamespacedResource(a, deps, selectionKey, "Service", namespace, name, func() (*ServiceDetails, error) {
		return network.NewService(deps).GetService(namespace, name)
	})
}

func (a *App) GetEndpointSlice(clusterID, namespace, name string) (*EndpointSliceDetails, error) {
	deps, selectionKey, err := a.resolveClusterDependencies(clusterID)
	if err != nil {
		return nil, err
	}
	return FetchNamespacedResource(a, deps, selectionKey, "EndpointSlice", namespace, name, func() (*EndpointSliceDetails, error) {
		return network.NewService(deps).EndpointSlice(namespace, name)
	})
}

func (a *App) GetIngress(clusterID, namespace, name string) (*IngressDetails, error) {
	deps, selectionKey, err := a.resolveClusterDependencies(clusterID)
	if err != nil {
		return nil, err
	}
	return FetchNamespacedResource(a, deps, selectionKey, "Ingress", namespace, name, func() (*IngressDetails, error) {
		return network.NewService(deps).Ingress(namespace, name)
	})
}

func (a *App) GetIngressClass(clusterID, name string) (*IngressClassDetails, error) {
	deps, selectionKey, err := a.resolveClusterDependencies(clusterID)
	if err != nil {
		return nil, err
	}
	return FetchClusterResource(a, deps, selectionKey, "IngressClass", name, func() (*IngressClassDetails, error) {
		return network.NewService(deps).IngressClass(name)
	})
}

func (a *App) GetNetworkPolicy(clusterID, namespace, name string) (*NetworkPolicyDetails, error) {
	deps, selectionKey, err := a.resolveClusterDependencies(clusterID)
	if err != nil {
		return nil, err
	}
	return FetchNamespacedResource(a, deps, selectionKey, "NetworkPolicy", namespace, name, func() (*NetworkPolicyDetails, error) {
		return network.NewService(deps).NetworkPolicy(namespace, name)
	})
}
