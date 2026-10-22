/*
 * backend/refresh/system/ingest_projectors.go
 *
 * Registers each streamed kind's Catalog-half and ObjectMap-half
 * projectors with the IngestManager before it starts, so one reflector intake feeds
 * the maintained store (Table half, the descriptor's StreamRow — already wired by the
 * manager), the object catalog (Catalog half, the kind's catalog Summary), and the
 * object map (ObjectMap half, the kind's graph node). The loop is generic over the
 * kind registry; it names no kind.
 */

package system

import (
	"fmt"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/luxury-yacht/app/backend/kind/kindregistry"
	"github.com/luxury-yacht/app/backend/kind/kindspec"
	"github.com/luxury-yacht/app/backend/kind/objectmapnode"
	"github.com/luxury-yacht/app/backend/objectcatalog"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
	"github.com/luxury-yacht/app/backend/refresh/snapshot"
	"github.com/luxury-yacht/app/backend/resourcekind"
)

// registerIngestProjectors wires the Catalog and ObjectMap projectors for every
// streamed kind onto the manager (the Table half is the descriptor's StreamRow,
// already built by the manager's projection). It must be called before the manager
// starts so every intake — including the initial relist — carries all three halves.
func registerIngestProjectors(mgr *ingest.IngestManager, clusterID string) {
	for _, d := range kindregistry.All {
		// A bespoke-reflector kind (Stream == nil: Pod, the workload kinds,
		// ReplicaSet, Service, EndpointSlice, Node, Namespace, Event) carries its own
		// ProjectFunc that builds every bundle half, so the generic Catalog/ObjectMap
		// projectors here do not apply: the manager has no generic StreamRow entry
		// to attach them to. The system wires each bespoke reflector separately.
		if d.Stream == nil {
			continue
		}
		gvr := d.Identity.GVR()
		mgr.RegisterCatalogProjector(gvr, objectcatalog.SummaryProjector(clusterID, d.Identity))
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

// registerPodReflector wires the bespoke pod reflector onto the manager. Pods has no
// streamspec.Descriptor, so the manager's generic StreamDescriptors loop never builds
// it; this registers a reflector + projecting store whose ProjectFunc is the four-half
// pod bundle projector (Table = zeroed-metrics PodSummary, Aggregate = PodAggregate,
// Catalog = catalog Summary, ObjectMap = pod graph node). The projector resolves the
// pod's ReplicaSet->Deployment and Job->CronJob owners through owner indexes fed by
// those kinds' reflectors. It must run before the hub starts so the pod reflector
// launches with the rest and its initial relist is sync-gated.
func registerPodReflector(
	mgr *ingest.IngestManager,
	meta snapshot.ClusterMeta,
	rsOwnerLookup func(namespace, name string) (metav1.OwnerReference, bool),
	jobOwnerLookup func(namespace, jobName string) (snapshot.JobControllerOwner, bool),
) {
	if mgr == nil {
		return
	}
	// retainTable=true: the pod standalone-synthesis (pod_aggregate_source) and the owner
	// heals (resourcestream/owner_heals.go) read the STORED Table half (PodSummary), so it
	// must not be dropped. Every other reflector below passes false — its Table half lives only in the
	// columnar maintained store after being fanned to the BundleSink.
	mgr.RegisterReflector(snapshot.PodGVR, snapshot.PodGVK, snapshot.NewPodIngestProjector(meta, snapshot.PodOwnerSources{
		ReplicaSetOwner:    rsOwnerLookup,
		JobControllerOwner: jobOwnerLookup,
	}), true)
	// The owner-key index serves the all-namespaces workload pod join
	// (pod_aggregate_source.go) and the owner heals (resourcestream/owner_heals.go).
	// It is a no-op when the cluster cannot serve pods.
	mgr.AddIndex(snapshot.PodGVR, snapshot.PodOwnerKeyIndexName, snapshot.PodOwnerKeyIndexValues)
}

// registerReplicaSetReflector wires the bespoke ReplicaSet reflector onto the
// manager. ReplicaSets have no table, so the bundle carries the catalog
// summary, the graph node, and the controlling owner the Pod projector reads.
func registerReplicaSetReflector(mgr *ingest.IngestManager, meta snapshot.ClusterMeta) error {
	if !mgr.RegisterReflector(snapshot.ReplicaSetGVR, snapshot.ReplicaSetGVK, snapshot.NewReplicaSetIngestProjector(meta), false) {
		return fmt.Errorf("register workload reflector: ReplicaSet")
	}
	return nil
}

// registerWorkloadReflectors wires the five bespoke workload reflectors onto the manager.
// Deployment/StatefulSet/DaemonSet/Job/CronJob have no streamspec.Descriptor (the workloads
// table is the bespoke cross-kind WorkloadSummary), so the manager's generic
// StreamDescriptors loop never builds them; this registers a reflector + projecting store per
// kind whose ProjectFunc is the kind's three-half bundle projector (Table = workload-own
// WorkloadSummary, Catalog = catalog Summary, ObjectMap = graph node). Each projection reads
// only the workload's own typed object — no lister needed (unlike pods, which resolve the RS
// owner). It must run before the hub starts so the workload reflectors launch with the rest
// and their initial relists are sync-gated.
func registerWorkloadReflectors(mgr *ingest.IngestManager, meta snapshot.ClusterMeta) error {
	if mgr == nil {
		return fmt.Errorf("register workload reflectors: ingest manager is nil")
	}
	if !mgr.RegisterReflector(snapshot.DeploymentGVR, snapshot.DeploymentGVK, snapshot.NewDeploymentIngestProjector(meta), false) {
		return fmt.Errorf("register workload reflector: Deployment")
	}
	if !mgr.RegisterReflector(snapshot.StatefulSetGVR, snapshot.StatefulSetGVK, snapshot.NewStatefulSetIngestProjector(meta), false) {
		return fmt.Errorf("register workload reflector: StatefulSet")
	}
	if !mgr.RegisterReflector(snapshot.DaemonSetGVR, snapshot.DaemonSetGVK, snapshot.NewDaemonSetIngestProjector(meta), false) {
		return fmt.Errorf("register workload reflector: DaemonSet")
	}
	if !mgr.RegisterReflector(snapshot.JobGVR, snapshot.JobGVK, snapshot.NewJobIngestProjector(meta), false) {
		return fmt.Errorf("register workload reflector: Job")
	}
	if !mgr.RegisterReflector(snapshot.CronJobGVR, snapshot.CronJobGVK, snapshot.NewCronJobIngestProjector(meta), false) {
		return fmt.Errorf("register workload reflector: CronJob")
	}
	return nil
}

// registerNodeReflector wires the bespoke node reflector onto the manager. Node has no
// streamspec.Descriptor (the nodes table is the bespoke NodeSummary whose row joins per-node
// pod aggregates + metrics), so the manager's generic StreamDescriptors loop never builds it;
// this registers a reflector + projecting store whose ProjectFunc is the node's four-half
// bundle projector (Table = OWN-fields NodeSummary, Aggregate = node-overview fact, Catalog =
// catalog Summary, ObjectMap = node graph node). The projection reads only the node's own typed
// object — no lister needed (unlike pods, which resolve the RS owner). It must run before the
// hub starts so the node reflector launches with the rest and its initial relist is sync-gated.
func registerNodeReflector(mgr *ingest.IngestManager, meta snapshot.ClusterMeta) {
	if mgr == nil {
		return
	}
	mgr.RegisterReflector(snapshot.NodeGVR, snapshot.NodeGVK, snapshot.NewNodeIngestProjector(meta), false)
}

// registerNamespaceReflector wires the bespoke namespace reflector onto the
// manager. Namespace has no streamspec.Descriptor: the namespaces table joins
// each namespace with workload presence, warning events, and quota pressure at
// serve, so the bundle keeps the namespace itself plus its catalog Summary.
func registerNamespaceReflector(mgr *ingest.IngestManager, meta snapshot.ClusterMeta) error {
	if !mgr.RegisterReflector(snapshot.NamespaceGVR, snapshot.NamespaceGVK, snapshot.NewNamespaceIngestProjector(meta), false) {
		return fmt.Errorf("register namespace reflector: Namespace")
	}
	return nil
}

// registerEventReflector wires the bespoke events reflector onto the manager: the
// Events table row (fanned to the table sinks, not stored), the catalog Summary, and the
// slim event fact every other Events reader uses.
func registerEventReflector(mgr *ingest.IngestManager, meta snapshot.ClusterMeta) error {
	if !mgr.RegisterReflector(snapshot.EventGVR, snapshot.EventGVK, snapshot.NewEventIngestProjector(meta), false) {
		return fmt.Errorf("register event reflector: Event")
	}
	return nil
}

// registerNetworkReflectors wires the two bespoke network reflectors onto the manager.
// Service and EndpointSlice have no streamspec.Descriptor (a Service's namespace-network row
// is built JOINED with its EndpointSlices, and EndpointSlice is both its own table row and
// that join input), so the manager's generic StreamDescriptors loop never builds them; this
// registers a reflector + projecting store per kind whose ProjectFunc is the kind's bespoke
// bundle projector (Service: OWN-fields NetworkSummary + catalog + object-map; EndpointSlice:
// NetworkSummary + Service-join Aggregate + catalog + object-map). Ingress and NetworkPolicy
// ARE Stream-backed, so the generic loop builds them — only Service/EndpointSlice are bespoke.
// It must run before the hub starts so the network reflectors launch with the rest and their
// initial relists are sync-gated.
func registerNetworkReflectors(mgr *ingest.IngestManager, meta snapshot.ClusterMeta) {
	if mgr == nil {
		return
	}
	mgr.RegisterReflector(snapshot.ServiceGVR, snapshot.ServiceGVK, snapshot.NewServiceIngestProjector(meta), false)
	mgr.RegisterReflector(snapshot.EndpointSliceGVR, snapshot.EndpointSliceGVK, snapshot.NewEndpointSliceIngestProjector(meta), false)
}

// registerCustomResourceIngest feeds the dynamic custom-resource sources from
// the CRD reflector. Dynamic rows use the same metadata projection as catalog
// LIST, without retaining it. A denied CRD reflector leaves the definitions
// table empty, so discovery keeps the dynamic LIST/promotion policy.
func registerCustomResourceIngest(mgr *ingest.IngestManager, clusterID string) {
	mgr.SetCustomResourceDefinitions(func(spec ingest.DynamicCatalogSpec) ingest.CatalogProjector {
		return objectcatalog.SummaryProjector(clusterID, resourcekind.Identity{Group: spec.GVR.Group, Version: spec.GVR.Version, Resource: spec.GVR.Resource, Kind: spec.GVK.Kind, Namespaced: spec.Namespaced})
	})
}
