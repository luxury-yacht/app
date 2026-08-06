/*
 * backend/resources/workloads/helpers.go
 *
 * Workload detail helper utilities.
 * - Shared aggregation and formatting helpers.
 */

package workloads

import (
	"fmt"
	"strconv"
	"strings"

	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/luxury-yacht/app/backend/resources/pods"
	restypes "github.com/luxury-yacht/app/backend/resources/types"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metricsv1beta1 "k8s.io/metrics/pkg/apis/metrics/v1beta1"
)

type podAverageAccumulator struct {
	cpuRequest, cpuLimit, memRequest, memLimit, cpuUsage, memUsage resource.Quantity
	cpuReqCount, cpuLimCount, memReqCount, memLimCount             int
	cpuUseCount, memUseCount                                       int
}

type podMetricsAccumulator struct {
	summary                                                        restypes.PodMetricsSummary
	cpuRequest, cpuLimit, cpuUsage, memRequest, memLimit, memUsage resource.Quantity
	restarts                                                       int32
}

func aggregatePodAverages(podSlice []corev1.Pod, podMetrics map[string]*metricsv1beta1.PodMetrics) (
	*resource.Quantity,
	*resource.Quantity,
	*resource.Quantity,
	*resource.Quantity,
	*resource.Quantity,
	*resource.Quantity,
) {
	if len(podSlice) == 0 {
		return nil, nil, nil, nil, nil, nil
	}

	accumulator := newPodAverageAccumulator()
	for _, pod := range podSlice {
		accumulator.addPod(pod, podMetrics)
	}
	return accumulator.averages()
}

func newPodAverageAccumulator() podAverageAccumulator {
	return podAverageAccumulator{
		cpuRequest: *resource.NewQuantity(0, resource.DecimalSI), cpuLimit: *resource.NewQuantity(0, resource.DecimalSI),
		memRequest: *resource.NewQuantity(0, resource.BinarySI), memLimit: *resource.NewQuantity(0, resource.BinarySI),
		cpuUsage: *resource.NewQuantity(0, resource.DecimalSI), memUsage: *resource.NewQuantity(0, resource.BinarySI),
	}
}

func (a *podAverageAccumulator) addPod(pod corev1.Pod, metrics map[string]*metricsv1beta1.PodMetrics) {
	cpuReq, cpuLim, memReq, memLim := pods.CalculatePodResources(pod)
	addNonZeroQuantity(&a.cpuRequest, &a.cpuReqCount, cpuReq)
	addNonZeroQuantity(&a.cpuLimit, &a.cpuLimCount, cpuLim)
	addNonZeroQuantity(&a.memRequest, &a.memReqCount, memReq)
	addNonZeroQuantity(&a.memLimit, &a.memLimCount, memLim)
	cpuUse, memUse := pods.PodUsageFromMetrics(pod.Name, metrics)
	addNonZeroQuantity(&a.cpuUsage, &a.cpuUseCount, cpuUse)
	addNonZeroQuantity(&a.memUsage, &a.memUseCount, memUse)
}

func addNonZeroQuantity(total *resource.Quantity, count *int, value *resource.Quantity) {
	if value != nil && !value.IsZero() {
		total.Add(*value)
		*count++
	}
}

func (a podAverageAccumulator) averages() (*resource.Quantity, *resource.Quantity, *resource.Quantity, *resource.Quantity, *resource.Quantity, *resource.Quantity) {
	return averageCPU(a.cpuRequest, a.cpuReqCount), averageCPU(a.cpuLimit, a.cpuLimCount),
		averageMemory(a.memRequest, a.memReqCount), averageMemory(a.memLimit, a.memLimCount),
		averageCPU(a.cpuUsage, a.cpuUseCount), averageMemory(a.memUsage, a.memUseCount)
}

func averageCPU(total resource.Quantity, count int) *resource.Quantity {
	if count == 0 {
		return nil
	}
	return resource.NewMilliQuantity(total.MilliValue()/int64(count), resource.DecimalSI)
}

func averageMemory(total resource.Quantity, count int) *resource.Quantity {
	if count == 0 {
		return nil
	}
	return resource.NewQuantity(total.Value()/int64(count), resource.BinarySI)
}

func SummarizePodMetrics(podSlice []corev1.Pod, podMetrics map[string]*metricsv1beta1.PodMetrics) (*restypes.PodMetricsSummary, int32) {
	accumulator := newPodMetricsAccumulator()
	for _, pod := range podSlice {
		accumulator.addPod(pod, podMetrics)
	}
	return accumulator.result()
}

func newPodMetricsAccumulator() podMetricsAccumulator {
	return podMetricsAccumulator{
		cpuRequest: *resource.NewQuantity(0, resource.DecimalSI), cpuLimit: *resource.NewQuantity(0, resource.DecimalSI),
		cpuUsage: *resource.NewQuantity(0, resource.DecimalSI), memRequest: *resource.NewQuantity(0, resource.BinarySI),
		memLimit: *resource.NewQuantity(0, resource.BinarySI), memUsage: *resource.NewQuantity(0, resource.BinarySI),
	}
}

func (a *podMetricsAccumulator) addPod(pod corev1.Pod, metrics map[string]*metricsv1beta1.PodMetrics) {
	if pod.Status.Phase == corev1.PodSucceeded || pod.Status.Phase == corev1.PodFailed {
		return
	}
	a.summary.Pods++
	ready, total := parseReadyStatus(pods.PodReadyStatus(pod))
	if total > 0 && ready == total {
		a.summary.ReadyPods++
	}
	a.restarts += pods.PodRestartCount(pod)
	cpuReq, cpuLim, memReq, memLim := pods.CalculatePodResources(pod)
	addQuantity(&a.cpuRequest, cpuReq)
	addQuantity(&a.cpuLimit, cpuLim)
	addQuantity(&a.memRequest, memReq)
	addQuantity(&a.memLimit, memLim)
	cpuUse, memUse := pods.PodUsageFromMetrics(pod.Name, metrics)
	addQuantity(&a.cpuUsage, cpuUse)
	addQuantity(&a.memUsage, memUse)
}

func addQuantity(total, value *resource.Quantity) {
	if value != nil {
		total.Add(*value)
	}
}

func (a *podMetricsAccumulator) result() (*restypes.PodMetricsSummary, int32) {
	a.summary.CPURequest = common.FormatCPU(&a.cpuRequest)
	a.summary.CPULimit = common.FormatCPU(&a.cpuLimit)
	a.summary.CPUUsage = common.FormatCPU(&a.cpuUsage)
	a.summary.MemRequest = common.FormatMemory(&a.memRequest)
	a.summary.MemLimit = common.FormatMemory(&a.memLimit)
	a.summary.MemUsage = common.FormatMemory(&a.memUsage)
	return &a.summary, a.restarts
}

func parseReadyStatus(value string) (ready, total int) {
	parts := strings.SplitN(value, "/", 2)
	if len(parts) != 2 {
		return 0, 0
	}
	readyVal, err := strconv.Atoi(parts[0])
	if err != nil {
		return 0, 0
	}
	totalVal, err := strconv.Atoi(parts[1])
	if err != nil {
		return 0, 0
	}
	return readyVal, totalVal
}

// BuildPodSummaries builds pod summaries with a hardcoded owner kind/name/apiVersion
// supplied by the workload caller (Deployment, StatefulSet, DaemonSet, ReplicaSet —
// all apps/v1). The apiVersion lets the panel open the owner with a fully-qualified
// GVK; see PodSimpleInfo.OwnerAPIVersion
func BuildPodSummaries(clusterID, ownerKind, ownerName, ownerAPIVersion string, podsList []corev1.Pod, podMetrics map[string]*metricsv1beta1.PodMetrics) []restypes.PodSimpleInfo {
	podInfos := make([]restypes.PodSimpleInfo, 0, len(podsList))
	for _, pod := range podsList {
		podInfos = append(podInfos, pods.SummarizePod(clusterID, pod, podMetrics, ownerKind, ownerName, ownerAPIVersion))
	}

	return podInfos
}

func DescribeContainers(containers []corev1.Container) []restypes.PodDetailInfoContainer {
	result := make([]restypes.PodDetailInfoContainer, 0, len(containers))
	for _, container := range containers {
		result = append(result, describeContainer(container))
	}
	return result
}

func describeContainer(container corev1.Container) restypes.PodDetailInfoContainer {
	detail := restypes.PodDetailInfoContainer{
		Name:            container.Name,
		Image:           container.Image,
		ImagePullPolicy: string(container.ImagePullPolicy),
		Command:         container.Command,
		Args:            container.Args,
	}
	applyWorkloadContainerResources(&detail, container.Resources)
	detail.Ports = formatWorkloadContainerPorts(container.Ports)
	detail.VolumeMounts = formatWorkloadContainerVolumeMounts(container.VolumeMounts)
	detail.Environment = formatWorkloadContainerEnvironment(container.Env)
	return detail
}

func applyWorkloadContainerResources(detail *restypes.PodDetailInfoContainer, requirements corev1.ResourceRequirements) {
	if cpu, ok := requirements.Requests[corev1.ResourceCPU]; ok {
		detail.CPURequest = common.FormatCPU(&cpu)
	}
	if cpu, ok := requirements.Limits[corev1.ResourceCPU]; ok {
		detail.CPULimit = common.FormatCPU(&cpu)
	}
	if memory, ok := requirements.Requests[corev1.ResourceMemory]; ok {
		detail.MemRequest = common.FormatMemory(&memory)
	}
	if memory, ok := requirements.Limits[corev1.ResourceMemory]; ok {
		detail.MemLimit = common.FormatMemory(&memory)
	}
}

func formatWorkloadContainerPorts(ports []corev1.ContainerPort) []string {
	var result []string
	for _, port := range ports {
		formatted := fmt.Sprintf("%d", port.ContainerPort)
		if port.Name != "" {
			formatted = fmt.Sprintf("%s (%s)", formatted, port.Name)
		}
		if port.Protocol != corev1.ProtocolTCP && port.Protocol != "" {
			formatted += fmt.Sprintf("/%s", port.Protocol)
		}
		result = append(result, formatted)
	}
	return result
}

func formatWorkloadContainerVolumeMounts(mounts []corev1.VolumeMount) []string {
	var result []string
	for _, mount := range mounts {
		formatted := fmt.Sprintf("%s -> %s", mount.Name, mount.MountPath)
		if mount.ReadOnly {
			formatted += " (ro)"
		}
		result = append(result, formatted)
	}
	return result
}

func formatWorkloadContainerEnvironment(variables []corev1.EnvVar) map[string]string {
	if len(variables) == 0 {
		return nil
	}
	result := make(map[string]string)
	for _, variable := range variables {
		if variable.Value != "" {
			result[variable.Name] = variable.Value
		} else if variable.ValueFrom != nil {
			result[variable.Name] = "<from source>"
		}
	}
	return result
}

// Job-specific helpers (filterPodsForJob, summarizeJob) and CronJob-specific
// helpers (defaultInt32, summarizeCronJob, calculateNextSchedule[At],
// formatCronJobSchedule) moved to resources/job and resources/cronjob with their
// detail builders.
