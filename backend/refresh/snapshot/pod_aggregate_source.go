/*
 * backend/refresh/snapshot/pod_aggregate_source.go
 *
 * The pod-aggregation read path for the informer-backed domains after the pod cut.
 * cluster-overview, nodes, and namespace-workloads no longer iterate typed pods: they
 * read the projected streamrows.PodAggregate the pod reflector already built at intake
 * (the Bundle's Aggregate half), keyed off the pod GVR. It is the same PodAggregate the
 * typed-pod path produced via projectPodAggregate, so every per-domain aggregation that
 * reads it stays byte-equivalent.
 *
 * The list-fallback builders (no informer permission) still list typed pods directly
 * and project them to PodAggregate via projectPodAggregate inline, so both paths
 * converge on the same []streamrows.PodAggregate the shared aggregation logic consumes.
 */

package snapshot

import (
	"sort"
	"strconv"

	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
	podres "github.com/luxury-yacht/app/backend/resources/pods"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

const podOwnerKeyIndexName = "pods:owner-key"

type podWorkloadsIndexedIngestSource interface {
	RowsByIndex(gvr schema.GroupVersionResource, indexName string, values []string) []interface{}
}

// podAggregateIngestSource supplies the projected per-pod aggregation rows for the cut
// pod kind, whose objects are no longer cached by the shared informer factory.
// *ingest.IngestManager satisfies it (its AggregateRows returns the Bundle Aggregate
// halves; StoreResourceVersion returns the store's latest list/watch RV). It is the
// read path the informer-backed aggregation domains use instead of a typed pod lister,
// mirroring the objectMapIngestSource the object map already uses.
type podAggregateIngestSource interface {
	AggregateRows(gvr schema.GroupVersionResource) []interface{}
	StoreResourceVersion(gvr schema.GroupVersionResource) string
}

// namespacePodRowsFromIngest reads the cut pod kind's projected bundles from the
// workloads ingest source in ONE consistent store read, returning the namespace's
// PodAggregate rows (for owner grouping and per-owner aggregation) and a PodSummary
// map keyed by "namespace/name" (for the standalone-pod row). Reading both halves from
// the same bundle guarantees a pod present in the aggregate slice is present in the
// summary map — a separate AggregateRows/TableRows pair could desync across a
// concurrent reflector mutation. A nil source yields empty results.
func namespacePodRowsFromIngest(source podWorkloadsIngestSource, namespace string) ([]streamrows.PodAggregate, map[string]streamrows.PodSummary) {
	if source == nil {
		return nil, nil
	}
	bundles := source.Rows(PodGVR)
	aggregates := make([]streamrows.PodAggregate, 0, len(bundles))
	summaries := make(map[string]streamrows.PodSummary, len(bundles))
	for _, raw := range bundles {
		bundle, ok := raw.(ingest.Bundle)
		if !ok {
			continue
		}
		agg, ok := bundle.Aggregate.(streamrows.PodAggregate)
		if !ok || agg.Namespace != namespace {
			continue
		}
		aggregates = append(aggregates, agg)
		if summary, ok := bundle.Table.(streamrows.PodSummary); ok {
			summaries[summary.Namespace+"/"+summary.Name] = summary
		}
	}
	return aggregates, summaries
}

// workloadOwnerPodRowsFromIngest reads projected pod bundles whose owner keys match the emitted
// workload OWN-rows. It is used by all-namespaces workload views, where namespace-wide standalone
// pod rows are intentionally not synthesized but workload-owned pods are still needed for status
// and resource reservation aggregation.
func workloadOwnerPodRowsFromIngest(source podWorkloadsIngestSource, ownRows []WorkloadSummary) ([]streamrows.PodAggregate, map[string]streamrows.PodSummary) {
	if source == nil || len(ownRows) == 0 {
		return nil, nil
	}
	owners := make(map[string]struct{}, len(ownRows))
	for _, row := range ownRows {
		if row.Kind == podres.Identity.Kind {
			continue
		}
		owners[workloadOwnerKey(row.Kind, row.Namespace, row.Name)] = struct{}{}
	}
	if len(owners) == 0 {
		return nil, nil
	}
	ownerKeys := make([]string, 0, len(owners))
	for owner := range owners {
		ownerKeys = append(ownerKeys, owner)
	}
	sort.Strings(ownerKeys)
	if indexed, ok := source.(podWorkloadsIndexedIngestSource); ok {
		bundles := indexed.RowsByIndex(PodGVR, podOwnerKeyIndexName, ownerKeys)
		return workloadOwnerPodRowsFromBundles(bundles, owners)
	}
	return workloadOwnerPodRowsFromBundles(source.Rows(PodGVR), owners)
}

func workloadOwnerPodRowsFromBundles(bundles []interface{}, owners map[string]struct{}) ([]streamrows.PodAggregate, map[string]streamrows.PodSummary) {
	aggregates := make([]streamrows.PodAggregate, 0, len(bundles))
	summaries := make(map[string]streamrows.PodSummary, len(bundles))
	for _, raw := range bundles {
		bundle, ok := raw.(ingest.Bundle)
		if !ok {
			continue
		}
		agg, ok := bundle.Aggregate.(streamrows.PodAggregate)
		if !ok {
			continue
		}
		if _, ok := owners[agg.OwnerKey]; !ok {
			continue
		}
		aggregates = append(aggregates, agg)
		if summary, ok := bundle.Table.(streamrows.PodSummary); ok {
			summaries[summary.Namespace+"/"+summary.Name] = summary
		}
	}
	return aggregates, summaries
}

// namespacePodIngestVersion returns the pod store's latest list/watch RV as the version
// watermark for a domain that reads pods through the workloads ingest source.
func namespacePodIngestVersion(source podWorkloadsIngestSource) uint64 {
	if source == nil {
		return 0
	}
	rv := source.StoreResourceVersion(PodGVR)
	if rv == "" {
		return 0
	}
	parsed, err := strconv.ParseUint(rv, 10, 64)
	if err != nil {
		return 0
	}
	return parsed
}

// podIngestVersion returns the pod store's latest list/watch resourceVersion as the
// uint64 watermark a snapshot domain folds into its version (in place of the per-pod
// RV it can no longer read). A nil source or an unparseable RV yields 0, so a domain
// with no ingest wired (a unit test) simply contributes no pod watermark.
func podIngestVersion(source podAggregateIngestSource) uint64 {
	if source == nil {
		return 0
	}
	rv := source.StoreResourceVersion(PodGVR)
	if rv == "" {
		return 0
	}
	parsed, err := strconv.ParseUint(rv, 10, 64)
	if err != nil {
		return 0
	}
	return parsed
}

// podAggregatesFromIngest reads the pod kind's projected PodAggregate rows from the
// ingest source. A nil source (a unit test with no ingest wired) yields no rows. Rows
// of an unexpected type are skipped, mirroring the type guards the ingest sinks apply.
func podAggregatesFromIngest(source podAggregateIngestSource) []streamrows.PodAggregate {
	if source == nil {
		return nil
	}
	raw := source.AggregateRows(PodGVR)
	out := make([]streamrows.PodAggregate, 0, len(raw))
	for _, row := range raw {
		if agg, ok := row.(streamrows.PodAggregate); ok {
			out = append(out, agg)
		}
	}
	return out
}
