package snapshot

import (
	"github.com/luxury-yacht/app/backend/kind/kindregistry"
	"github.com/luxury-yacht/app/backend/kind/objectmapnode"
)

// objectMapIngestOwnedGVRs is the set of GVRs cut over to the owned-reflector ingest
// path, derived from the single kind registry's IngestOwned facet. collectTyped reads
// these kinds' object-map nodes from the ingest source instead of the shared informer
// lister; flipping the facet on the next domain's kinds adds them here automatically.
var objectMapIngestOwnedGVRs = kindregistry.IngestOwnedGVRs()

// objectMapCollectors is every kind read into the object map from the shared
// informer cache, derived from the single kind registry. Each kind declares how it
// is listed and projected in its own package; the collector loop never names a
// kind. HorizontalPodAutoscaler is collected bespoke from the v2 informer, and
// Gateway-API projections come via objectMapGatewayCollectors.
var objectMapCollectors = objectMapCollectorsFromRegistry()

// objectMapGatewayCollectors is the Gateway-API projection registry. Objects are
// read from the Gateway informer factory and gated by cluster API presence.
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
