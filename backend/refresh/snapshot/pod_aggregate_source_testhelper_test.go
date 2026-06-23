package snapshot

import (
	"strconv"

	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
	podres "github.com/luxury-yacht/app/backend/resources/pods"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
	appslisters "k8s.io/client-go/listers/apps/v1"
)

// fakePodAggregateSource is a test podAggregateIngestSource: it returns the supplied
// PodAggregate rows for the pod GVR (and nothing for any other GVR), standing in for
// the ingest manager's AggregateRows in domain unit tests after the pod cut. A non-empty
// resourceVersion lets a test drive the pod-derived version watermark.
type fakePodAggregateSource struct {
	aggregates      []streamrows.PodAggregate
	resourceVersion string
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
	if gvr != PodGVR {
		return ""
	}
	return s.resourceVersion
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
		bundles = append(bundles, ingest.Bundle{
			Table:     podres.BuildStreamSummary(streamMeta, pod, 0, 0, rsLister),
			Aggregate: projectPodAggregate(pod, rsLister),
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
