package snapshot

import (
	"strconv"

	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/objectcatalog"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
	podres "github.com/luxury-yacht/app/backend/resources/pods"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
	appslisters "k8s.io/client-go/listers/apps/v1"
)

// fakePodAggregateSource is a test podAggregateIngestSource / clusterOverviewIngestSource:
// it returns the supplied PodAggregate rows for the pod GVR and the supplied workload
// catalog rows (keyed by GVR) for the cut workload kinds, standing in for the ingest
// manager in domain unit tests after the pod + workload cut. A non-empty resourceVersion
// lets a test drive the pod-derived version watermark; workloadCatalog/workloadSynced let a
// test drive the cluster-overview workload counts (len of catalog rows, gated on synced).
type fakePodAggregateSource struct {
	aggregates      []streamrows.PodAggregate
	resourceVersion string
	podSynced       *bool
	workloadCatalog map[schema.GroupVersionResource][]interface{}
	workloadSynced  map[schema.GroupVersionResource]bool
	// nodeBundles are the cut node kind's projected bundles (Table=NodeSummary own-row,
	// Aggregate=nodeOverviewFact), returned for NodeGVR via Rows. nodeSynced gates the
	// cluster-overview / nodes domain node read on store readiness (default false).
	nodeBundles []ingest.Bundle
	nodeSynced  bool
	nodeRV      string
}

func (s fakePodAggregateSource) AggregateRows(gvr schema.GroupVersionResource) []interface{} {
	if gvr != PodGVR {
		return nil
	}
	out := make([]interface{}, 0, len(s.aggregates))
	for _, agg := range s.aggregates {
		out = append(out, agg)
	}
	return out
}

func (s fakePodAggregateSource) StoreResourceVersion(gvr schema.GroupVersionResource) string {
	switch gvr {
	case PodGVR:
		return s.resourceVersion
	case NodeGVR:
		return s.nodeRV
	default:
		return ""
	}
}

// Rows returns the cut node kind's projected bundles for NodeGVR (the nodes domain reads the
// Table-half own-rows and the cluster-overview reads the Aggregate-half facts through it), or
// nil otherwise.
func (s fakePodAggregateSource) Rows(gvr schema.GroupVersionResource) []interface{} {
	if gvr != NodeGVR {
		return nil
	}
	out := make([]interface{}, 0, len(s.nodeBundles))
	for _, b := range s.nodeBundles {
		out = append(out, b)
	}
	return out
}

// CatalogRows returns the supplied workload catalog rows for a cut workload GVR (used by
// the cluster-overview / namespaces workload counts), or nil otherwise.
func (s fakePodAggregateSource) CatalogRows(gvr schema.GroupVersionResource) []interface{} {
	return s.workloadCatalog[gvr]
}

// HasSyncedFor reports the per-GVR synced flag for a cut workload GVR (default false), so a
// test can gate the cluster-overview workload counts on store readiness; the pod GVR
// reports true so pod-aggregate reads are never gated out in unit tests.
func (s fakePodAggregateSource) HasSyncedFor(gvr schema.GroupVersionResource) bool {
	switch gvr {
	case PodGVR:
		if s.podSynced != nil {
			return *s.podSynced
		}
		return true
	case NodeGVR:
		return s.nodeSynced
	default:
		return s.workloadSynced[gvr]
	}
}

func (s fakePodAggregateSource) withPodSynced(synced bool) fakePodAggregateSource {
	s.podSynced = &synced
	return s
}

// AddSink lets this source stand in for the ingest manager wherever a
// namespacePodIngestSource (which embeds the tracker's Sink-registration interface)
// is required. The namespace builder's legacy workload-presence detection reads
// CatalogRows/AggregateRows only; the Sink registration runs through the tracker,
// which these tests build directly, so no sink is ever fed here.
func (s fakePodAggregateSource) AddSink(_ schema.GroupVersionResource, _ ingest.Sink) bool {
	return false
}

// AddBundleSink mirrors AddSink for the workload kinds, whose tracker feed is a whole-bundle
// Sink (their stored bundle drops the Table half). No bundle is fed here for the same reason.
func (s fakePodAggregateSource) AddBundleSink(_ schema.GroupVersionResource, _ ingest.BundleSink) bool {
	return false
}

// Tracks reports the cut workload + pod kinds as tracked, standing in for the ingest manager's
// entry set wherever a namespacePodIngestSource is required.
func (s fakePodAggregateSource) Tracks(gvr schema.GroupVersionResource) bool {
	switch gvr {
	case DeploymentGVR, StatefulSetGVR, DaemonSetGVR, JobGVR, CronJobGVR, PodGVR:
		return true
	default:
		return false
	}
}

// withWorkloadCatalog returns a copy of the source carrying `count` projected catalog rows
// for the workload GVR, marked synced, so a cluster-overview / namespaces test drives the
// kind's count (the count is len(CatalogRows)). The rows are minimal objectcatalog.Summary
// values in the given namespace — only namespace + presence matter to the counters.
func (s fakePodAggregateSource) withWorkloadCatalog(gvr schema.GroupVersionResource, namespace string, count int) fakePodAggregateSource {
	if s.workloadCatalog == nil {
		s.workloadCatalog = map[schema.GroupVersionResource][]interface{}{}
	}
	if s.workloadSynced == nil {
		s.workloadSynced = map[schema.GroupVersionResource]bool{}
	}
	rows := make([]interface{}, 0, count)
	for i := 0; i < count; i++ {
		rows = append(rows, objectcatalog.Summary{Namespace: namespace, Name: "wl-" + strconv.Itoa(i)})
	}
	s.workloadCatalog[gvr] = rows
	s.workloadSynced[gvr] = true
	return s
}

// withNodes returns a copy of the source carrying the supplied typed nodes projected to the
// node ingest bundles (Table=NodeSummary own-row, Aggregate=nodeOverviewFact) exactly as the
// node ingest projector does, marked synced, so a cluster-overview / nodes domain test feeds
// the builder exactly the rows ingest would supply for those nodes. meta stamps the row
// cluster identity. nodeRV drives the node-derived version watermark when non-empty.
func (s fakePodAggregateSource) withNodes(meta ClusterMeta, nodeRV string, nodes ...*corev1.Node) fakePodAggregateSource {
	project := NewNodeIngestProjector(meta)
	bundles := make([]ingest.Bundle, 0, len(nodes))
	for _, node := range nodes {
		if node == nil {
			continue
		}
		raw, err := project(node)
		if err != nil {
			continue
		}
		bundles = append(bundles, raw.(ingest.Bundle))
	}
	s.nodeBundles = bundles
	s.nodeSynced = true
	s.nodeRV = nodeRV
	return s
}

// newFakePodAggregateSource projects the supplied typed pods to PodAggregate rows the
// same way the pod ingest projector does, so a domain test feeds the informer-backed
// builder exactly the rows ingest would supply for those pods. rsLister resolves the
// metrics-bucketing WorkloadKind (pass nil for domains that never read it).
func newFakePodAggregateSource(rsLister appslisters.ReplicaSetLister, pods ...*corev1.Pod) fakePodAggregateSource {
	aggregates := make([]streamrows.PodAggregate, 0, len(pods))
	for _, pod := range pods {
		if pod == nil {
			continue
		}
		aggregates = append(aggregates, projectPodAggregate(pod, rsLister))
	}
	return fakePodAggregateSource{aggregates: aggregates}
}

// fakePodWorkloadsIngestSource is a test podWorkloadsIngestSource: it returns the pod
// kind's projected bundles (Table=PodSummary + Aggregate=PodAggregate) for the pod GVR,
// standing in for the ingest manager's Rows in workloads domain unit tests. It projects
// the supplied typed pods exactly as the pod ingest projector does.
type fakePodWorkloadsIngestSource struct {
	bundles         []ingest.Bundle
	resourceVersion string
}

func (s fakePodWorkloadsIngestSource) Rows(gvr schema.GroupVersionResource) []interface{} {
	if gvr != PodGVR {
		return nil
	}
	out := make([]interface{}, 0, len(s.bundles))
	for _, b := range s.bundles {
		out = append(out, b)
	}
	return out
}

func (s fakePodWorkloadsIngestSource) RowsByIndex(gvr schema.GroupVersionResource, indexName string, values []string) []interface{} {
	if gvr != PodGVR || indexName != podOwnerKeyIndexName || len(values) == 0 {
		return nil
	}
	wanted := make(map[string]struct{}, len(values))
	for _, value := range values {
		wanted[value] = struct{}{}
	}
	out := make([]interface{}, 0, len(s.bundles))
	for _, b := range s.bundles {
		for _, ownerKey := range b.Indexes[podOwnerKeyIndexName] {
			if _, ok := wanted[ownerKey]; ok {
				out = append(out, b)
				break
			}
		}
	}
	return out
}

func (s fakePodWorkloadsIngestSource) StoreResourceVersion(gvr schema.GroupVersionResource) string {
	if gvr != PodGVR {
		return ""
	}
	return s.resourceVersion
}

// newFakePodWorkloadsIngestSource projects the supplied typed pods to the Table +
// Aggregate bundle halves the workloads domain reads. resourceVersion is the highest
// typed pod RV, so the workloads version watermark matches the prior typed-pod path.
// rsLister resolves the owner for the PodSummary Table half (RS->Deployment collapse).
func newFakePodWorkloadsIngestSource(meta ClusterMeta, rsLister appslisters.ReplicaSetLister, pods ...*corev1.Pod) fakePodWorkloadsIngestSource {
	streamMeta := meta // ClusterMeta is a type alias of streamrows.ClusterMeta
	bundles := make([]ingest.Bundle, 0, len(pods))
	var maxRV uint64
	for _, pod := range pods {
		if pod == nil {
			continue
		}
		aggregate := projectPodAggregate(pod, rsLister)
		bundles = append(bundles, ingest.Bundle{
			Table:     podSummaryWithoutMetrics(podres.BuildStreamSummary(streamMeta, pod, 0, 0, rsLister)),
			Aggregate: aggregate,
			Indexes:   podAggregateBundleIndexes(aggregate),
		})
		if rv, err := strconv.ParseUint(pod.ResourceVersion, 10, 64); err == nil && rv > maxRV {
			maxRV = rv
		}
	}
	src := fakePodWorkloadsIngestSource{bundles: bundles}
	if maxRV > 0 {
		src.resourceVersion = strconv.FormatUint(maxRV, 10)
	}
	return src
}
