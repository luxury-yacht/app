package resourcestream

import "github.com/luxury-yacht/app/backend/refresh/informer"

// This file registers network resource streams. Network resources stay together
// because several handlers need service, route, or policy listers, and Gateway
// API resources come from a separate informer factory.

func (m *Manager) registerNetworkStreams(factory *informer.Factory) {
	shared := factory.SharedInformerFactory()
	if shared != nil {
		if m.canListWatch("", "services") {
			serviceInformer := shared.Core().V1().Services()
			m.serviceLister = serviceInformer.Lister()
			m.addResourceEventHandler(serviceInformer.Informer(), (*Manager).handleService)
		}
		if m.canListWatch("discovery.k8s.io", "endpointslices") {
			sliceInformer := shared.Discovery().V1().EndpointSlices()
			m.sliceLister = sliceInformer.Lister()
			m.addResourceEventHandler(sliceInformer.Informer(), (*Manager).handleEndpointSlice)
		}
		if m.canListWatch("networking.k8s.io", "ingresses") {
			ingressInformer := shared.Networking().V1().Ingresses()
			m.ingressLister = ingressInformer.Lister()
			m.addResourceEventHandler(ingressInformer.Informer(), (*Manager).handleIngress)
		}
		if m.canListWatch("networking.k8s.io", "networkpolicies") {
			policyInformer := shared.Networking().V1().NetworkPolicies()
			m.policyLister = policyInformer.Lister()
			m.addResourceEventHandler(policyInformer.Informer(), (*Manager).handleNetworkPolicy)
		}
	}

	gatewayShared := factory.GatewayInformerFactory()
	if gatewayShared == nil {
		return
	}
	gateway := gatewayShared.Gateway().V1()
	if m.canListWatch("gateway.networking.k8s.io", "gateways") {
		m.addResourceEventHandler(gateway.Gateways().Informer(), (*Manager).handleGateway)
	}
	if m.canListWatch("gateway.networking.k8s.io", "httproutes") {
		m.addResourceEventHandler(gateway.HTTPRoutes().Informer(), (*Manager).handleHTTPRoute)
	}
	if m.canListWatch("gateway.networking.k8s.io", "grpcroutes") {
		m.addResourceEventHandler(gateway.GRPCRoutes().Informer(), (*Manager).handleGRPCRoute)
	}
	if m.canListWatch("gateway.networking.k8s.io", "tlsroutes") {
		m.addResourceEventHandler(gateway.TLSRoutes().Informer(), (*Manager).handleTLSRoute)
	}
	if m.canListWatch("gateway.networking.k8s.io", "listenersets") {
		m.addResourceEventHandler(gateway.ListenerSets().Informer(), (*Manager).handleListenerSet)
	}
	if m.canListWatch("gateway.networking.k8s.io", "referencegrants") {
		m.addResourceEventHandler(gateway.ReferenceGrants().Informer(), (*Manager).handleReferenceGrant)
	}
	if m.canListWatch("gateway.networking.k8s.io", "backendtlspolicies") {
		m.addResourceEventHandler(gateway.BackendTLSPolicies().Informer(), (*Manager).handleBackendTLSPolicy)
	}
}
