package backend

import "github.com/luxury-yacht/app/backend/resources/gatewayapi"

func (a *App) GetGatewayClass(clusterID, name string) (*GatewayClassDetails, error) {
	deps, selectionKey, err := a.resolveClusterDependencies(clusterID)
	if err != nil {
		return nil, err
	}
	return FetchClusterResource(a, deps, selectionKey, "GatewayClass", name, func() (*GatewayClassDetails, error) {
		return gatewayapi.NewService(deps).GatewayClass(name)
	})
}

func (a *App) GetGateway(clusterID, namespace, name string) (*GatewayDetails, error) {
	deps, selectionKey, err := a.resolveClusterDependencies(clusterID)
	if err != nil {
		return nil, err
	}
	return FetchNamespacedResource(a, deps, selectionKey, "Gateway", namespace, name, func() (*GatewayDetails, error) {
		return gatewayapi.NewService(deps).Gateway(namespace, name)
	})
}

func (a *App) GetHTTPRoute(clusterID, namespace, name string) (*HTTPRouteDetails, error) {
	deps, selectionKey, err := a.resolveClusterDependencies(clusterID)
	if err != nil {
		return nil, err
	}
	return FetchNamespacedResource(a, deps, selectionKey, "HTTPRoute", namespace, name, func() (*HTTPRouteDetails, error) {
		return gatewayapi.NewService(deps).HTTPRoute(namespace, name)
	})
}

func (a *App) GetGRPCRoute(clusterID, namespace, name string) (*GRPCRouteDetails, error) {
	deps, selectionKey, err := a.resolveClusterDependencies(clusterID)
	if err != nil {
		return nil, err
	}
	return FetchNamespacedResource(a, deps, selectionKey, "GRPCRoute", namespace, name, func() (*GRPCRouteDetails, error) {
		return gatewayapi.NewService(deps).GRPCRoute(namespace, name)
	})
}

func (a *App) GetTLSRoute(clusterID, namespace, name string) (*TLSRouteDetails, error) {
	deps, selectionKey, err := a.resolveClusterDependencies(clusterID)
	if err != nil {
		return nil, err
	}
	return FetchNamespacedResource(a, deps, selectionKey, "TLSRoute", namespace, name, func() (*TLSRouteDetails, error) {
		return gatewayapi.NewService(deps).TLSRoute(namespace, name)
	})
}

func (a *App) GetListenerSet(clusterID, namespace, name string) (*ListenerSetDetails, error) {
	deps, selectionKey, err := a.resolveClusterDependencies(clusterID)
	if err != nil {
		return nil, err
	}
	return FetchNamespacedResource(a, deps, selectionKey, "ListenerSet", namespace, name, func() (*ListenerSetDetails, error) {
		return gatewayapi.NewService(deps).ListenerSet(namespace, name)
	})
}

func (a *App) GetReferenceGrant(clusterID, namespace, name string) (*ReferenceGrantDetails, error) {
	deps, selectionKey, err := a.resolveClusterDependencies(clusterID)
	if err != nil {
		return nil, err
	}
	return FetchNamespacedResource(a, deps, selectionKey, "ReferenceGrant", namespace, name, func() (*ReferenceGrantDetails, error) {
		return gatewayapi.NewService(deps).ReferenceGrant(namespace, name)
	})
}

func (a *App) GetBackendTLSPolicy(clusterID, namespace, name string) (*BackendTLSPolicyDetails, error) {
	deps, selectionKey, err := a.resolveClusterDependencies(clusterID)
	if err != nil {
		return nil, err
	}
	return FetchNamespacedResource(a, deps, selectionKey, "BackendTLSPolicy", namespace, name, func() (*BackendTLSPolicyDetails, error) {
		return gatewayapi.NewService(deps).BackendTLSPolicy(namespace, name)
	})
}
