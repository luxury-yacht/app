package resourcestream

import "github.com/luxury-yacht/app/backend/refresh/informer"

// This file registers network resource streams. Network resources stay together
// because several handlers need service, route, or policy listers, and Gateway
// API resources come from a separate informer factory.

// registerNetworkStreams wires the network kinds whose handlers need a
// manager-level lister (service/endpointslice correlation). The plain
// object→row network + Gateway-API kinds are registered from the descriptor
// registry; see registerDescriptorStreams.
func (m *Manager) registerNetworkStreams(factory *informer.Factory) {
	shared := factory.SharedInformerFactory()
	if shared == nil {
		return
	}
	if m.canListWatch("", "services") {
		serviceInformer := shared.Core().V1().Services()
		m.serviceLister = serviceInformer.Lister()
		m.addResourceEventHandler(serviceInformer.Informer(), (*Manager).handleService)
	}
	if m.canListWatch("discovery.k8s.io", "endpointslices") {
		sliceInformer := shared.Discovery().V1().EndpointSlices()
		m.sliceLister = sliceInformer.Lister()
		m.addRelatedResourceEventHandler(sliceInformer.Informer(), (*Manager).handleEndpointSliceEvent)
	}
}
