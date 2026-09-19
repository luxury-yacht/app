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

	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
	podres "github.com/luxury-yacht/app/backend/resources/pods"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

const podOwnerKeyIndexName = "pods:owner-key"

type podWorkloadsIndexReader interface {
	RowsByIndex(gvr schema.GroupVersionResource, indexName string, values []string) []interface{}
}

// podAggregateIngestSource supplies the projected per-pod aggregation rows for the cut
// pod kind, whose objects are no longer cached by the shared informer factory.
// *ingest.IngestManager satisfies it (its AggregateRows returns the Bundle Aggregate
// halves; StoreResourceVersion returns the store's latest list/watch RV). It is the
// read path the informer-backed aggregation domains use instead of a typed pod lister,
// mirroring the objectMapRowsProvider the object map already uses.
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
	return podRowsFromBundles(source.Rows(PodGVR), func(aggregate streamrows.PodAggregate) bool {
		return aggregate.Namespace == namespace
	})
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
		if row.Ref.Kind == podres.Identity.Kind {
			continue
		}
		owners[workloadOwnerKey(row.Ref.Kind, row.Ref.Namespace, row.Ref.Name)] = struct{}{}
	}
	if len(owners) == 0 {
		return nil, nil
	}
	ownerKeys := make([]string, 0, len(owners))
	for owner := range owners {
		ownerKeys = append(ownerKeys, owner)
	}
	sort.Strings(ownerKeys)
	var bundles []interface{}
	if indexed, ok := source.(podWorkloadsIndexReader); ok {
		bundles = indexed.RowsByIndex(PodGVR, podOwnerKeyIndexName, ownerKeys)
	} else {
		bundles = source.Rows(PodGVR)
	}
	return podRowsFromBundles(bundles, func(aggregate streamrows.PodAggregate) bool {
		_, included := owners[aggregate.OwnerKey]
		return included
	})
}

// podRowsFromBundles keeps the table and aggregate halves paired from one store read.
func podRowsFromBundles(bundles []interface{}, include func(streamrows.PodAggregate) bool) ([]streamrows.PodAggregate, map[string]streamrows.PodSummary) {
	aggregates := make([]streamrows.PodAggregate, 0, len(bundles))
	summaries := make(map[string]streamrows.PodSummary, len(bundles))
	for _, raw := range bundles {
		bundle, ok := raw.(ingest.Bundle)
		if !ok {
			continue
		}
		agg, ok := bundle.Aggregate.(streamrows.PodAggregate)
		if !ok || !include(agg) {
			continue
		}
		aggregates = append(aggregates, agg)
		if summary, ok := bundle.Table.(streamrows.PodSummary); ok {
			summaries[summary.Ref.Namespace+"/"+summary.Ref.Name] = summary
		}
	}
	return aggregates, summaries
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
