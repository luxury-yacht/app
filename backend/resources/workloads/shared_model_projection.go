/*
 * backend/resources/workloads/shared_model_projection.go
 *
 * Projects shared resource model facts into workload detail DTO fields so the
 * extraction lives in one place (the model) instead of being recomputed in each
 * detail builder.
 */

package workloads

import (
	"fmt"

	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/luxury-yacht/app/backend/resources/common"
	restypes "github.com/luxury-yacht/app/backend/resources/types"
	corev1 "k8s.io/api/core/v1"
	metricsv1beta1 "k8s.io/metrics/pkg/apis/metrics/v1beta1"
)

// WorkloadReplicaDisplay renders the shared "ready/total" replica strings for
// workloads backed by WorkloadCommonFacts (Deployment, StatefulSet, ReplicaSet),
// keeping the projection in one place. DaemonSet reports the same facts under
// different DTO field names and reads them directly.
func WorkloadReplicaDisplay(f resourcemodel.WorkloadCommonFacts) (replicas, ready string) {
	replicas = fmt.Sprintf("%d/%d", f.CurrentReplicas, f.DesiredReplicas)
	ready = fmt.Sprintf("%d/%d", f.ReadyReplicas, f.CurrentReplicas)
	return replicas, ready
}

// WorkloadUtilization computes the display-ready average per-pod resource
// utilization shared by all workload detail builders, centralizing the
// aggregate + format step instead of repeating it per builder.
func WorkloadUtilization(podsList []corev1.Pod, podMetrics map[string]*metricsv1beta1.PodMetrics) restypes.ResourceUtilization {
	avgCPURequest, avgCPULimit, avgMemRequest, avgMemLimit, avgCPUUsage, avgMemUsage := aggregatePodAverages(podsList, podMetrics)
	return restypes.ResourceUtilization{
		CPURequest: common.FormatCPU(avgCPURequest),
		CPULimit:   common.FormatCPU(avgCPULimit),
		CPUUsage:   common.FormatCPU(avgCPUUsage),
		MemRequest: common.FormatMemory(avgMemRequest),
		MemLimit:   common.FormatMemory(avgMemLimit),
		MemUsage:   common.FormatMemory(avgMemUsage),
	}
}
