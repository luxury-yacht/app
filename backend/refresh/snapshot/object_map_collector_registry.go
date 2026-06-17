package snapshot

import (
	"github.com/luxury-yacht/app/backend/refresh/kindregistry"
	"github.com/luxury-yacht/app/backend/refresh/objectmapnode"
)

// objectMapCollectors is every kind read into the object map from the shared
// informer cache, derived from the single kind registry. Each kind declares how it
// is listed and projected in its own package; the collector loop never names a
// kind. HorizontalPodAutoscaler (no v2 informer) is collected bespoke, and the
// Gateway-API kinds (live client) come via objectMapGatewayCollectors.
var objectMapCollectors = objectMapCollectorsFromRegistry()

// objectMapGatewayCollectors is the Gateway-API equivalent, listed via the Gateway
// client and gated by the cluster's Gateway-API presence.
var objectMapGatewayCollectors = objectMapGatewayCollectorsFromRegistry()

func objectMapCollectorsFromRegistry() []objectmapnode.Collector {
	out := make([]objectmapnode.Collector, 0, len(kindregistry.All))
	for _, d := range kindregistry.All {
		if d.Collector != nil {
			out = append(out, *d.Collector)
		}
	}
	return out
}

func objectMapGatewayCollectorsFromRegistry() []objectmapnode.GatewayCollector {
	out := make([]objectmapnode.GatewayCollector, 0, len(kindregistry.All))
	for _, d := range kindregistry.All {
		if d.GatewayCollector != nil {
			out = append(out, *d.GatewayCollector)
		}
	}
	return out
}
