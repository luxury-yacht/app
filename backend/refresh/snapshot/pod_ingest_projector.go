/*
 * backend/refresh/snapshot/pod_ingest_projector.go
 *
 * The pod kind's owned-reflector ingest projector. Pods has NO streamspec.Descriptor
 * (its table is the bespoke PodSummary, not the generic StreamRow dispatch), so the
 * IngestManager's StreamDescriptors loop never builds it. NewPodIngestProjector is the
 * bespoke ProjectFunc the system wires onto the manager via RegisterReflector: it
 * projects each reflector-decoded Pod into a four-half ingest.Bundle so one intake
 * feeds every pod consumer, and the typed Pod is then dropped:
 *
 *   - Table     = the no-data-metrics PodSummary (pods.BuildStreamSummary plus
 *                 podSummaryWithoutMetrics);
 *   - Aggregate = the PodAggregate the cluster-overview/nodes/namespace-workloads
 *                 domains read (projectPodAggregate);
 *   - Catalog   = the object-catalog Summary (objectcatalog.SummaryProjector);
 *   - ObjectMap = the object-map graph node (objectmapnode.NewNodeProjector from the
 *                 pod descriptor's collector + edges).
 *
 * The Table and Aggregate halves both resolve the pod's ReplicaSet->Deployment owner
 * via the SAME rsLister, so the owner KIND/name and the metrics-bucketing WorkloadKind
 * match the typed-pod paths byte-for-byte (proven in pod_ingest_projector_test.go and
 * pod_aggregate_test.go).
 */

package snapshot

import (
	"github.com/luxury-yacht/app/backend/kind/objectmapnode"
	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/objectcatalog"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
	podres "github.com/luxury-yacht/app/backend/resources/pods"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

// PodGVR / PodGVK are the pod kind's group/version/resource and group/version/kind,
// the keys the system wires the bespoke pod reflector under (RegisterReflector) and
// every cut-aware consumer reads the ingest store with.
var (
	PodGVR = schema.GroupVersionResource{Group: podres.Identity.Group, Version: podres.Identity.Version, Resource: podres.Identity.Resource}
	PodGVK = schema.GroupVersionKind{Group: podres.Identity.Group, Version: podres.Identity.Version, Kind: podres.Identity.Kind}
)

// NewPodIngestProjector returns the ingest.ProjectFunc that projects a reflector-
// decoded Pod into the four-half Bundle every pod consumer reads. meta stamps the
// PodSummary's cluster identity and the catalog Summary / object-map node cluster id;
// rsLister resolves the ReplicaSet->Deployment owner for the Table half's OwnerKind
// and the Aggregate half's WorkloadKind (the metrics-bucketing kind). The Table half
// carries no-data metrics so base pod rows do not depend on the metrics provider.
func NewPodIngestProjector(meta ClusterMeta, sources PodOwnerSources) ingest.ProjectFunc {
	// ClusterMeta is a type alias of streamrows.ClusterMeta, so meta is the stream meta.
	streamMeta := meta
	catalogProject := objectcatalog.SummaryProjector(meta.ClusterID, meta.ClusterName, podres.Identity)
	nodeProject := objectmapnode.NewNodeProjector(
		podres.ObjectMapNode.Status,
		podres.ObjectMapNode.ActionFacts,
		podres.ObjectMapEdges,
	)
	return func(obj interface{}) (interface{}, error) {
		pod, ok := obj.(*corev1.Pod)
		if !ok {
			return nil, errNotPodObject
		}
		var metaObj metav1.Object = pod
		table := podSummaryWithoutMetrics(podres.BuildStreamSummary(
			streamMeta, pod, 0, 0,
			sources.ReplicaSets,
			jobOwnerLookupAdapter(sources.JobControllerOwner),
		))
		aggregate := projectPodAggregateFromSummary(pod, sources, table)
		return ingest.Bundle{
			Table:     table,
			Aggregate: aggregate,
			Catalog:   catalogProject(metaObj),
			ObjectMap: nodeProject(meta.ClusterID, metaObj),
			Indexes:   podAggregateBundleIndexes(aggregate),
		}, nil
	}
}

func podAggregateBundleIndexes(aggregate streamrows.PodAggregate) map[string][]string {
	if aggregate.OwnerKey == "" {
		return nil
	}
	return map[string][]string{podOwnerKeyIndexName: []string{aggregate.OwnerKey}}
}

// errNotPodObject is returned when the reflector decodes a non-Pod into the pod store;
// the ProjectingStore logs it once and skips the object, matching the per-kind type
// guard every projection applies.
var errNotPodObject = podProjectionError("ingest: pod projector received a non-Pod object")

type podProjectionError string

func (e podProjectionError) Error() string { return string(e) }
