// backend/refresh/snapshot/workload_reaggregate.go
//
// The serve-side re-join for the cut workload kinds. Deployment/StatefulSet/DaemonSet/
// Job/CronJob are projected at intake into a workload-OWN-fields WorkloadSummary (status,
// name, namespace, age, port-forward, desired replicas, and the fallback Ready) by the
// SAME buildXSummary the serve path calls — but with nil pods and nil usage, so the
// pod-aggregate join + metrics are absent. At serve the workloads domain re-joins the
// owner's pods + the fresh metrics sample onto the projected own-row, reproducing the
// exact WorkloadSummary the typed buildXSummary would build with those pods + usage
// (proven in workload_reaggregate_test.go).
package snapshot

import (
	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/refresh/metrics"
	"github.com/luxury-yacht/app/backend/resources/daemonset"
	"github.com/luxury-yacht/app/backend/resources/deployment"
	"github.com/luxury-yacht/app/backend/resources/statefulset"
	corev1 "k8s.io/api/core/v1"
)

// reaggregateWorkloadSummary overlays the owner's pod-aggregate join + metrics onto a
// projected workload-own row, returning the full WorkloadSummary the typed buildXSummary
// would produce. The own-row supplies every field read from the typed object alone
// (status/name/namespace/age/port-forward/desired-replicas + the fallback Ready); this
// re-join overwrites only the pod-join fields (Restarts + cpu/mem request/limit), the
// metrics usage (cpu/mem), and — for the pod-counted Ready kinds — the Ready string.
//
// Ready handling mirrors the per-kind builders exactly:
//   - Deployment/StatefulSet/DaemonSet compute Ready via workloadPodReadyStatus(pods,
//     fallbackReady, fallbackTotal); the fallback is the (ready,total) the projected
//     own-row already encodes (it was built with nil pods, so its Ready IS the fallback).
//   - Job and CronJob never pod-join Ready (it is completed/desired or the active count),
//     so the projected own-row's Ready is final and carried through unchanged.
//
// HPAManaged is applied by the caller (appendSummary) after this re-join, exactly as in
// the typed path, so it is intentionally untouched here.
func reaggregateWorkloadSummary(own WorkloadSummary, pods []streamrows.PodAggregate, usage map[string]metrics.PodUsage) WorkloadSummary {
	resources := aggregateWorkloadPodResources(pods, usage)

	summary := own
	if workloadUsesPodReadyStatus(own.Kind) {
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
