/*
 * backend/refresh/snapshot/network_ingest_projector.go
 *
 * The network join kinds' owned-reflector ingest projectors. Service and EndpointSlice
 * have NO streamspec.Descriptor: a Service's namespace-network row is built JOINED with
 * its correlated EndpointSlices (the per-object StreamRow cannot carry the join), and
 * EndpointSlice is BOTH its own table row AND that join input. So the IngestManager's
 * generic StreamDescriptors loop never builds them; each NewXIngestProjector is the
 * bespoke ProjectFunc the system wires onto the manager via RegisterReflector, mirroring
 * the workload/pod projectors:
 *
 *   - Table     = the OWN-fields NetworkSummary. For Service it is built with NIL slices
 *                 (service.BuildStreamSummary(meta, svc, nil)) — the endpoint count join is
 *                 re-applied at serve from the projected EndpointSlice store
 *                 (reaggregateServiceSummary), so the serve-side join stays byte-identical.
 *                 For EndpointSlice it is the full row (endpointslice.BuildStreamSummary);
 *   - Catalog   = the object-catalog Summary (objectcatalog.SummaryProjector);
 *   - ObjectMap = the object-map graph node (objectmapnode.NewNodeProjector from the kind's
 *                 collector status + action facts + edges).
 *
 * The Service Table half is built by the SAME service.BuildStreamSummary the serve path
 * calls, invoked with nil slices — so the own-fields the reflector projects and the
 * own-fields the serve path computes come from one function, guaranteeing byte-equivalence
 * (proven in network_ingest_projector_test.go). The endpoint-count join is NOT projected;
 * it is re-joined at serve from the already-cut EndpointSlice store.
 */

package snapshot

import (
	"github.com/luxury-yacht/app/backend/kind/objectmapnode"
	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/objectcatalog"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
	"github.com/luxury-yacht/app/backend/resources/endpointslice"
	"github.com/luxury-yacht/app/backend/resources/ingress"
	"github.com/luxury-yacht/app/backend/resources/networkpolicy"
	"github.com/luxury-yacht/app/backend/resources/service"
	corev1 "k8s.io/api/core/v1"
	discoveryv1 "k8s.io/api/discovery/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

// Service / EndpointSlice GVRs / GVKs are the keys the system wires each bespoke network
// reflector under (RegisterReflector) and every cut-aware consumer reads the ingest store
// with. IngressGVR / NetworkPolicyGVR are the generic-ingest (Stream-backed) cut kinds'
// resources, read by the namespace-network serve path and the version watermark.
var (
	ServiceGVR       = schema.GroupVersionResource{Group: service.Identity.Group, Version: service.Identity.Version, Resource: service.Identity.Resource}
	EndpointSliceGVR = schema.GroupVersionResource{Group: endpointslice.Identity.Group, Version: endpointslice.Identity.Version, Resource: endpointslice.Identity.Resource}
	IngressGVR       = schema.GroupVersionResource{Group: ingress.Identity.Group, Version: ingress.Identity.Version, Resource: ingress.Identity.Resource}
	NetworkPolicyGVR = schema.GroupVersionResource{Group: networkpolicy.Identity.Group, Version: networkpolicy.Identity.Version, Resource: networkpolicy.Identity.Resource}

	ServiceGVK       = schema.GroupVersionKind{Group: service.Identity.Group, Version: service.Identity.Version, Kind: service.Identity.Kind}
	EndpointSliceGVK = schema.GroupVersionKind{Group: endpointslice.Identity.Group, Version: endpointslice.Identity.Version, Kind: endpointslice.Identity.Kind}
)

// networkProjectionError is the typed guard error a network projector returns when the
// reflector decodes the wrong object type into its store; the ProjectingStore logs it once
// and skips the object, matching the per-kind type guard every projection applies.
type networkProjectionError string

func (e networkProjectionError) Error() string { return string(e) }

// NewServiceIngestProjector returns the ProjectFunc that projects a reflector-decoded
// Service into the three-half Bundle every Service consumer reads. The Table half is the
// OWN-fields NetworkSummary (service.BuildStreamSummary with nil slices); the serve path
// re-joins the endpoint count from the EndpointSlice store.
func NewServiceIngestProjector(meta ClusterMeta) ingest.ProjectFunc {
	catalogProject := objectcatalog.SummaryProjector(meta.ClusterID, meta.ClusterName, service.Identity)
	nodeProject := objectmapnode.NewNodeProjector(service.ObjectMapNode.Status, service.ObjectMapNode.ActionFacts, service.ObjectMapEdges)
	return func(obj interface{}) (interface{}, error) {
		svc, ok := obj.(*corev1.Service)
		if !ok {
			return nil, networkProjectionError("ingest: service projector received a non-Service object")
		}
		var metaObj metav1.Object = svc
		return ingest.Bundle{
			Table:     service.BuildStreamSummary(meta, svc, nil),
			Catalog:   catalogProject(metaObj),
			ObjectMap: nodeProject(meta.ClusterID, metaObj),
		}, nil
	}
}

// NewEndpointSliceIngestProjector returns the ProjectFunc that projects a reflector-decoded
// EndpointSlice into the three-half Bundle. The Table half is the full EndpointSlice row
// (endpointslice.BuildStreamSummary — EndpointSlice is its own table row and needs no
// cross-kind join); the namespace-network serve path also reads this store to re-join the
// endpoint count onto Service rows.
func NewEndpointSliceIngestProjector(meta ClusterMeta) ingest.ProjectFunc {
	catalogProject := objectcatalog.SummaryProjector(meta.ClusterID, meta.ClusterName, endpointslice.Identity)
	nodeProject := objectmapnode.NewNodeProjector(endpointslice.ObjectMapNode.Status, endpointslice.ObjectMapNode.ActionFacts, endpointslice.ObjectMapEdges)
	return func(obj interface{}) (interface{}, error) {
		slice, ok := obj.(*discoveryv1.EndpointSlice)
		if !ok {
			return nil, networkProjectionError("ingest: endpointslice projector received a non-EndpointSlice object")
		}
		var metaObj metav1.Object = slice
		return ingest.Bundle{
			Table:     endpointslice.BuildStreamSummary(meta, slice),
			Aggregate: projectEndpointSliceServiceFact(slice),
			Catalog:   catalogProject(metaObj),
			ObjectMap: nodeProject(meta.ClusterID, metaObj),
		}, nil
	}
}

// projectEndpointSliceServiceFact reduces an EndpointSlice to its Service-join fact: the
// owning Service's name (the kubernetes.io/service-name label) and this slice's ready
// endpoint-address count, computed by the SAME aggregation service.BuildFacts uses. The
// namespace-network serve path sums these per Service and re-joins the count onto the
// Service row (reaggregateServiceSummary).
func projectEndpointSliceServiceFact(slice *discoveryv1.EndpointSlice) streamrows.EndpointSliceServiceFact {
	return streamrows.EndpointSliceServiceFact{
		Namespace:          slice.Namespace,
		ServiceName:        slice.Labels[discoveryv1.LabelServiceName],
		ReadyEndpointCount: service.ReadyEndpointCount([]*discoveryv1.EndpointSlice{slice}),
	}
}
