/*
 * backend/refresh/snapshot/workload_ingest_source.go
 *
 * The workload version-watermark read path for the namespace-workloads domain after the
 * workload cut. Deployment/StatefulSet/DaemonSet/Job/CronJob are owned-reflector ingest kinds:
 * the shared factory no longer caches the typed object. Each kind's projected workload-OWN-fields
 * WorkloadSummary (the Bundle's Table half) is fed straight into the domain's maintained store by
 * the kind's Table-half ingest Sink (RegisterNamespaceWorkloadsDomain), so the domain reads
 * own-rows from RAM rather than pulling them here.
 *
 * What remains here is the version watermark: each kind's store carries the latest list/watch RV,
 * so the domain folds the highest store RV into its version watermark in place of the per-object RV
 * it can no longer read from the dropped typed objects.
 */

package snapshot

import (
	"strconv"

	"k8s.io/apimachinery/pkg/runtime/schema"
)

// workloadIngestSource supplies the cut workload kinds' store RVs for the namespace-workloads
// version watermark. The own-rows themselves no longer come from here — they are Sink-fed into the
// domain's maintained store — so only StoreResourceVersion is needed. *ingest.IngestManager
// satisfies it.
type workloadIngestSource interface {
	StoreResourceVersion(gvr schema.GroupVersionResource) string
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
