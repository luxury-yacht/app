/*
 * backend/refresh/system/ingest_projectors.go
 *
 * Registers each ingest-owned (cut) kind's Catalog-half and ObjectMap-half
 * projectors with the IngestManager before it starts, so one reflector intake feeds
 * the maintained store (Table half, the descriptor's StreamRow — already wired by the
 * manager), the object catalog (Catalog half, the kind's catalog Summary), and the
 * object map (ObjectMap half, the kind's graph node). The loop is generic over the
 * registry's IngestOwned facet; it names no kind.
 */

package system

import (
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/luxury-yacht/app/backend/kind/kindregistry"
	"github.com/luxury-yacht/app/backend/kind/kindspec"
	"github.com/luxury-yacht/app/backend/kind/objectmapnode"
	"github.com/luxury-yacht/app/backend/objectcatalog"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
)

// registerIngestProjectors wires the Catalog and ObjectMap projectors for every
// ingest-owned kind onto the manager (the Table half is the descriptor's StreamRow,
// already built by the manager's projection). It must be called before the manager
// starts so every intake — including the initial relist — carries all three halves.
func registerIngestProjectors(mgr *ingest.IngestManager, clusterID, clusterName string) {
	for _, d := range kindregistry.IngestOwnedDescriptors() {
		gvr := d.Identity.GVR()
		mgr.RegisterCatalogProjector(gvr, objectcatalog.SummaryProjector(clusterID, clusterName, d.Identity))
		if projector := ingestObjectMapProjector(clusterID, d); projector != nil {
			mgr.RegisterObjectMapProjector(gvr, projector)
		}
	}
}

// ingestObjectMapProjector builds a kind's ObjectMap-half projector from its registry
// collector (graph-node status + action facts) and edge builder, or nil when the kind
// has no object-map collector (it contributes no graph node — e.g. ResourceQuota and
// LimitRange, which have no objectmapnode.Collector). The projector returns the
// objectmapnode.Node the snapshot object-map index consumes.
func ingestObjectMapProjector(clusterID string, d kindspec.Descriptor) ingest.ObjectMapProjector {
	if d.Collector == nil {
		return nil
	}
	collector := d.Collector
	edges := d.Edges
	nodeProjector := objectmapnode.NewNodeProjector(collector.Status, collector.ActionFacts, edges)
	return func(obj metav1.Object) interface{} {
		return nodeProjector(clusterID, obj)
	}
}
