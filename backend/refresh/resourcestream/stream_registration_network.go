package resourcestream

import (
	"github.com/luxury-yacht/app/backend/refresh/informer"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
)

// This file registers network resource streams. Service and EndpointSlice are owned-reflector
// ingest kinds (IngestOwned): the typed informers are never instantiated, so their signal-only
// change signal comes from the ingest reflector's Catalog-half Sink (registerNetworkIngestNotify)
// instead of a shared-informer event handler — identical to the pod/workload path. The plain
// object→row Ingress/NetworkPolicy (also cut) and the Gateway-API kinds are registered from the
// descriptor registry (registerDescriptorStreams + the generic ingest notify); see those.
//
// The typed handleService / handleEndpointSlice* handlers + serviceLister/sliceLister remain
// for the unit tests that drive them directly with wired typed listers; production wires no
// network listers (the kinds are cut).
func (m *Manager) registerNetworkStreams(factory *informer.Factory, ingestManager *ingest.IngestManager) {
	if factory.SharedInformerFactory() == nil {
		return
	}
	m.registerNetworkIngestNotify(ingestManager)
}
