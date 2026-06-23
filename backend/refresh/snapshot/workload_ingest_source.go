/*
 * backend/refresh/snapshot/workload_ingest_source.go
 *
 * The workload read path for the namespace-workloads domain after the workload cut.
 * Deployment/StatefulSet/DaemonSet/Job/CronJob are owned-reflector ingest kinds: the
 * shared factory no longer caches the typed object, so the workloads domain reads the
 * projected workload-OWN-fields WorkloadSummary (the Bundle's Table half) the workload
 * reflector built at intake, keyed off each kind's GVR, instead of a typed lister. The
 * serve path then re-joins the owner's pods + metrics + HPA onto each own-row
 * (reaggregateWorkloadSummary), reproducing the pre-cut row byte for byte.
 *
 * Each kind's per-object Table half also carries the object's resourceVersion through the
 * ingest store's watermark, so the domain folds the store RV into its version watermark in
 * place of the per-object RV it can no longer read from the dropped typed objects.
 */

package snapshot

import (
	"strconv"

	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

// workloadIngestSource supplies the cut workload kinds' projected own-field rows the
// namespace-workloads domain reads. Rows returns each kind's projected Table-half
// WorkloadSummary in one consistent store read; StoreResourceVersion gives the store's
// latest list/watch RV for the version watermark. *ingest.IngestManager satisfies it.
type workloadIngestSource interface {
	Rows(gvr schema.GroupVersionResource) []interface{}
	StoreResourceVersion(gvr schema.GroupVersionResource) string
}

// namespaceWorkloadOwnRows reads the cut workload kind's projected own-field rows from the
// ingest source for the given GVR, filtered to the namespace ("" = all namespaces). A nil
// source yields no rows; a row of the wrong type is skipped, mirroring the type guards the
// ingest sinks apply. The returned rows are the workload-OWN-fields WorkloadSummary the
// serve path re-joins pods/metrics/HPA onto.
func namespaceWorkloadOwnRows(source workloadIngestSource, gvr schema.GroupVersionResource, namespace string) []streamrows.WorkloadSummary {
	if source == nil {
		return nil
	}
	rows := source.Rows(gvr)
	out := make([]streamrows.WorkloadSummary, 0, len(rows))
	for _, raw := range rows {
		// The store holds the projected Bundle per object; the workload own-fields row is
		// its Table half (mirroring the pod path's bundle unwrap in namespacePodRowsFromIngest).
		bundle, ok := raw.(ingest.Bundle)
		if !ok {
			continue
		}
		summary, ok := bundle.Table.(streamrows.WorkloadSummary)
		if !ok {
			continue
		}
		if namespace != "" && summary.Namespace != namespace {
			continue
		}
		out = append(out, summary)
	}
	return out
}

// namespaceWorkloadIngestVersion returns the highest store RV across the cut workload
// kinds' stores as the version watermark contribution for a workloads build that reads
// workloads through the ingest source. A nil source or unparseable RVs contribute 0.
func namespaceWorkloadIngestVersion(source workloadIngestSource, gvrs ...schema.GroupVersionResource) uint64 {
	if source == nil {
		return 0
	}
	var max uint64
	for _, gvr := range gvrs {
		rv := source.StoreResourceVersion(gvr)
		if rv == "" {
			continue
		}
		parsed, err := strconv.ParseUint(rv, 10, 64)
		if err != nil {
			continue
		}
		if parsed > max {
			max = parsed
		}
	}
	return max
}
