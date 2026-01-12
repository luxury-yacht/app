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
	"time"

	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/luxury-yacht/app/backend/resources/pods"
	restypes "github.com/luxury-yacht/app/backend/resources/types"
	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metricsv1beta1 "k8s.io/metrics/pkg/apis/metrics/v1beta1"
)

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

	totalCPURequest := resource.NewQuantity(0, resource.DecimalSI)
	totalCPULimit := resource.NewQuantity(0, resource.DecimalSI)
	totalMemRequest := resource.NewQuantity(0, resource.BinarySI)
	totalMemLimit := resource.NewQuantity(0, resource.BinarySI)
	totalCPUUsage := resource.NewQuantity(0, resource.DecimalSI)
	totalMemUsage := resource.NewQuantity(0, resource.BinarySI)

	cpuReqCount, cpuLimCount, memReqCount, memLimCount := 0, 0, 0, 0
	cpuUseCount, memUseCount := 0, 0

	for _, pod := range podSlice {
		cpuReq, cpuLim, memReq, memLim := pods.CalculatePodResources(pod)
		if cpuReq != nil && !cpuReq.IsZero() {
			totalCPURequest.Add(*cpuReq)
			cpuReqCount++
		}
		if cpuLim != nil && !cpuLim.IsZero() {
			totalCPULimit.Add(*cpuLim)
			cpuLimCount++
		}
		if memReq != nil && !memReq.IsZero() {
			totalMemRequest.Add(*memReq)
			memReqCount++
		}
		if memLim != nil && !memLim.IsZero() {
			totalMemLimit.Add(*memLim)
			memLimCount++
		}

		cpuUse, memUse := pods.PodUsageFromMetrics(pod.Name, podMetrics)
		if cpuUse != nil && !cpuUse.IsZero() {
			totalCPUUsage.Add(*cpuUse)
			cpuUseCount++
		}
		if memUse != nil && !memUse.IsZero() {
			totalMemUsage.Add(*memUse)
			memUseCount++
		}
	}

	var avgCPURequest, avgCPULimit, avgMemRequest, avgMemLimit, avgCPUUsage, avgMemUsage *resource.Quantity
	if cpuReqCount > 0 {
		avgCPURequest = resource.NewMilliQuantity(totalCPURequest.MilliValue()/int64(cpuReqCount), resource.DecimalSI)
	}
	if cpuLimCount > 0 {
		avgCPULimit = resource.NewMilliQuantity(totalCPULimit.MilliValue()/int64(cpuLimCount), resource.DecimalSI)
	}
	if memReqCount > 0 {
		avgMemRequest = resource.NewQuantity(totalMemRequest.Value()/int64(memReqCount), resource.BinarySI)
	}
	if memLimCount > 0 {
		avgMemLimit = resource.NewQuantity(totalMemLimit.Value()/int64(memLimCount), resource.BinarySI)
	}
	if cpuUseCount > 0 {
		avgCPUUsage = resource.NewMilliQuantity(totalCPUUsage.MilliValue()/int64(cpuUseCount), resource.DecimalSI)
	}
	if memUseCount > 0 {
		avgMemUsage = resource.NewQuantity(totalMemUsage.Value()/int64(memUseCount), resource.BinarySI)
	}

	return avgCPURequest, avgCPULimit, avgMemRequest, avgMemLimit, avgCPUUsage, avgMemUsage
}

func summarizePodMetrics(podSlice []corev1.Pod, podMetrics map[string]*metricsv1beta1.PodMetrics) (*restypes.PodMetricsSummary, int32) {
	summary := &restypes.PodMetricsSummary{}
	cpuRequest := resource.NewQuantity(0, resource.DecimalSI)
	cpuLimit := resource.NewQuantity(0, resource.DecimalSI)
	cpuUsage := resource.NewQuantity(0, resource.DecimalSI)
	memRequest := resource.NewQuantity(0, resource.BinarySI)
	memLimit := resource.NewQuantity(0, resource.BinarySI)
	memUsage := resource.NewQuantity(0, resource.BinarySI)

	var restarts int32

	for _, pod := range podSlice {
		if pod.Status.Phase == corev1.PodSucceeded || pod.Status.Phase == corev1.PodFailed {
			continue
		}

		summary.Pods++
		readyContainers, totalContainers := parseReadyStatus(pods.PodReadyStatus(pod))
		if totalContainers > 0 && readyContainers == totalContainers {
			summary.ReadyPods++
		}

		restarts += pods.PodRestartCount(pod)

		cpuReq, cpuLim, memReq, memLim := pods.CalculatePodResources(pod)
		if cpuReq != nil {
			cpuRequest.Add(*cpuReq)
		}
		if cpuLim != nil {
			cpuLimit.Add(*cpuLim)
		}
		if memReq != nil {
			memRequest.Add(*memReq)
		}
		if memLim != nil {
			memLimit.Add(*memLim)
		}

		if useCPU, useMem := pods.PodUsageFromMetrics(pod.Name, podMetrics); useCPU != nil || useMem != nil {
			if useCPU != nil {
				cpuUsage.Add(*useCPU)
			}
			if useMem != nil {
				memUsage.Add(*useMem)
			}
		}
	}

	summary.CPURequest = common.FormatCPU(cpuRequest)
	summary.CPULimit = common.FormatCPU(cpuLimit)
	summary.CPUUsage = common.FormatCPU(cpuUsage)
	summary.MemRequest = common.FormatMemory(memRequest)
	summary.MemLimit = common.FormatMemory(memLimit)
	summary.MemUsage = common.FormatMemory(memUsage)

	return summary, restarts
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

func buildPodSummaries(ownerKind, ownerName string, podsList []corev1.Pod, podMetrics map[string]*metricsv1beta1.PodMetrics) []restypes.PodSimpleInfo {
	podInfos := make([]restypes.PodSimpleInfo, 0, len(podsList))
	for _, pod := range podsList {
		cpuReq, cpuLim, memReq, memLim := pods.CalculatePodResources(pod)
		cpuUse, memUse := pods.PodUsageFromMetrics(pod.Name, podMetrics)

		podInfos = append(podInfos, restypes.PodSimpleInfo{
			Name:       pod.Name,
			Kind:       "Pod",
			Namespace:  pod.Namespace,
			Status:     string(pod.Status.Phase),
			Ready:      pods.PodReadyStatus(pod),
			Restarts:   pods.PodRestartCount(pod),
			Age:        common.FormatAge(pod.CreationTimestamp.Time),
			CPURequest: common.FormatCPU(cpuReq),
			CPULimit:   common.FormatCPU(cpuLim),
			CPUUsage:   common.FormatCPU(cpuUse),
			MemRequest: common.FormatMemory(memReq),
			MemLimit:   common.FormatMemory(memLim),
			MemUsage:   common.FormatMemory(memUse),
			OwnerKind:  ownerKind,
			OwnerName:  ownerName,
		})
	}

	return podInfos
}

func describeContainers(containers []corev1.Container) []restypes.PodDetailInfoContainer {
	result := make([]restypes.PodDetailInfoContainer, 0, len(containers))
	for _, container := range containers {
		detail := restypes.PodDetailInfoContainer{
			Name:            container.Name,
			Image:           container.Image,
			ImagePullPolicy: string(container.ImagePullPolicy),
			Command:         container.Command,
			Args:            container.Args,
		}

		if container.Resources.Requests != nil {
			if cpu, ok := container.Resources.Requests[corev1.ResourceCPU]; ok {
				detail.CPURequest = common.FormatCPU(&cpu)
			}
			if mem, ok := container.Resources.Requests[corev1.ResourceMemory]; ok {
				detail.MemRequest = common.FormatMemory(&mem)
			}
		}
		if container.Resources.Limits != nil {
			if cpu, ok := container.Resources.Limits[corev1.ResourceCPU]; ok {
				detail.CPULimit = common.FormatCPU(&cpu)
			}
			if mem, ok := container.Resources.Limits[corev1.ResourceMemory]; ok {
				detail.MemLimit = common.FormatMemory(&mem)
			}
		}

		if len(container.Ports) > 0 {
			detail.Ports = make([]string, 0, len(container.Ports))
			for _, port := range container.Ports {
				portStr := fmt.Sprintf("%d", port.ContainerPort)
				if port.Name != "" {
					portStr = fmt.Sprintf("%s (%s)", portStr, port.Name)
				}
				if port.Protocol != corev1.ProtocolTCP && port.Protocol != "" {
					portStr += fmt.Sprintf("/%s", port.Protocol)
				}
				detail.Ports = append(detail.Ports, portStr)
			}
		}

		if len(container.VolumeMounts) > 0 {
			detail.VolumeMounts = make([]string, 0, len(container.VolumeMounts))
			for _, mount := range container.VolumeMounts {
				mountStr := fmt.Sprintf("%s -> %s", mount.Name, mount.MountPath)
				if mount.ReadOnly {
					mountStr += " (ro)"
				}
				detail.VolumeMounts = append(detail.VolumeMounts, mountStr)
			}
		}

		if len(container.Env) > 0 {
			detail.Environment = make(map[string]string)
			for _, env := range container.Env {
				if env.Value != "" {
					detail.Environment[env.Name] = env.Value
				} else if env.ValueFrom != nil {
					detail.Environment[env.Name] = "<from source>"
				}
			}
		}

		result = append(result, detail)
	}

	return result
}

func defaultInt32(ptr *int32, fallback int32) int32 {
	if ptr != nil {
		return *ptr
	}
	return fallback
}

func filterPodsForJob(job *batchv1.Job, podList *corev1.PodList) []corev1.Pod {
	if podList == nil {
		return nil
	}

	var filtered []corev1.Pod
	for _, pod := range podList.Items {
		for _, owner := range pod.OwnerReferences {
			if owner.Controller != nil && *owner.Controller && owner.Kind == "Job" && owner.UID == job.UID {
				filtered = append(filtered, pod)
				break
			}
		}
	}
	return filtered
}

func summarizeJob(job *batchv1.Job, details *restypes.JobDetails) string {
	completions := details.Completions
	summary := fmt.Sprintf("Status: %s, Succeeded: %d/%d", details.Status, job.Status.Succeeded, completions)
	if job.Status.Failed > 0 {
		summary += fmt.Sprintf(", Failed: %d", job.Status.Failed)
	}
	return summary
}

func summarizeCronJob(details *restypes.CronJobDetails) string {
	summary := fmt.Sprintf("Schedule: %s", details.Schedule)
	if details.Suspend {
		summary += " (suspended)"
	} else if details.LastScheduleTime != nil {
		summary += fmt.Sprintf(", Last: %s ago", common.FormatAge(details.LastScheduleTime.Time))
	}
	return summary
}

func calculateNextSchedule(_ string, lastSchedule time.Time) (string, string) {
	nextTime := lastSchedule.Add(time.Minute)
	timeUntil := time.Until(nextTime)
	if timeUntil > 0 {
		return nextTime.Format(time.RFC3339), common.FormatAge(time.Now().Add(-timeUntil))
	}
	return "Now", "0s"
}
