// Serving joins each retained workload row with its owner's current pod aggregates
// and metrics. HPA ownership is applied by the snapshot assembler afterward.
package snapshot

import (
	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/refresh/metrics"
	"github.com/luxury-yacht/app/backend/resources/daemonset"
	"github.com/luxury-yacht/app/backend/resources/deployment"
	"github.com/luxury-yacht/app/backend/resources/statefulset"
	corev1 "k8s.io/api/core/v1"
)

// reaggregateWorkloadSummary overlays only pod and metric fields on an intake row.
// Deployment, StatefulSet and DaemonSet readiness uses pod counts when available;
// Job completions and CronJob active counts remain the projected own value.
func reaggregateWorkloadSummary(own WorkloadSummary, pods []streamrows.PodAggregate, usage map[string]metrics.PodUsage) WorkloadSummary {
	resources := aggregateWorkloadPodResources(pods, usage)

	summary := own
	if workloadUsesPodReadyStatus(own.Ref.Kind) {
		summary.Ready = reaggregateWorkloadReady(own.Ready, pods)
	}
	summary.Restarts = resources.Restarts
	summary.CPUUsage = formatWorkloadCPUMilli(resources.CPUUsageMilli)
	summary.CPURequest = formatWorkloadCPUMilli(resources.CPURequestMilli)
	summary.CPULimit = formatWorkloadCPUMilli(resources.CPULimitMilli)
	summary.MemUsage = formatWorkloadMemory(resources.MemoryUsageBytes)
	summary.MemRequest = formatWorkloadMemory(resources.MemoryRequestBytes)
	summary.MemLimit = formatWorkloadMemory(resources.MemoryLimitBytes)
	return summary
}

func reaggregateWorkloadReady(fallback string, pods []streamrows.PodAggregate) string {
	ready, total, ok := parseReadyPairInt32(fallback)
	if ok {
		return workloadPodReadyStatus(pods, ready, total)
	}
	if workloadHasReadyStatusPods(pods) {
		return workloadPodReadyStatus(pods, 0, 0)
	}
	return fallback
}

func workloadHasReadyStatusPods(pods []streamrows.PodAggregate) bool {
	for _, agg := range pods {
		if agg.Phase != string(corev1.PodSucceeded) && agg.Phase != string(corev1.PodFailed) {
			return true
		}
	}
	return false
}

// workloadUsesPodReadyStatus reports whether a kind's Ready string is the pod-counted
// readiness (Deployment/StatefulSet/DaemonSet) rather than a fixed own-field value (Job's
// completed/desired, CronJob's active count). It is the one place the re-join branches on
// kind, mirroring which builders call workloadPodReadyStatus.
func workloadUsesPodReadyStatus(kind string) bool {
	switch kind {
	case deployment.Identity.Kind, statefulset.Identity.Kind, daemonset.Identity.Kind:
		return true
	default:
		return false
	}
}
