package workloads

import (
	"context"
	"fmt"
	"sort"
	"sync"
	"time"

	"github.com/luxury-yacht/app/backend/internal/parallel"
	"github.com/luxury-yacht/app/backend/resources/common"
	restypes "github.com/luxury-yacht/app/backend/resources/types"
)

// WorkloadInfo represents a workload with basic information.
type WorkloadInfo struct {
	Kind      string `json:"kind"`
	Name      string `json:"name"`
	Namespace string `json:"namespace"`
	Ready     string `json:"ready"`
	Status    string `json:"status"`
	Restarts  int32  `json:"restarts"`
	Age       string `json:"age"`
	// Resource fields for ResourceBar
	CPUUsage   string `json:"cpuUsage,omitempty"`
	CPURequest string `json:"cpuRequest,omitempty"`
	CPULimit   string `json:"cpuLimit,omitempty"`
	MemUsage   string `json:"memUsage,omitempty"`
	MemRequest string `json:"memRequest,omitempty"`
	MemLimit   string `json:"memLimit,omitempty"`
}

// GetWorkloads returns all workloads in a namespace with aggregated resource usage.
func GetWorkloads(deps common.Dependencies, namespace string) ([]*WorkloadInfo, error) {
	logger := deps.Logger
	if deps.EnsureClient == nil {
		return nil, fmt.Errorf("workloads: EnsureClient dependency not provided")
	}
	if err := deps.EnsureClient("workload resources"); err != nil {
		return nil, err
	}
	if deps.KubernetesClient == nil {
		return nil, fmt.Errorf("kubernetes client not initialized")
	}

	startTime := time.Now()
	logger.Info(fmt.Sprintf("Loading workloads for namespace %s using domain services", namespace), "ResourceLoader")

	var (
		workloadsMu sync.Mutex
		workloads   []*WorkloadInfo
	)

	tasks := []func(context.Context) error{
		func(context.Context) error {
			details, err := NewDeploymentService(deps).Deployments(namespace)
			if err != nil {
				logger.Warn(fmt.Sprintf("Failed to list Deployments in namespace %s: %v", namespace, err), "ResourceLoader")
				return nil
			}
			items := make([]*WorkloadInfo, 0, len(details))
			for _, detail := range details {
				items = append(items, buildDeploymentWorkload(detail))
			}
			if len(items) > 0 {
				workloadsMu.Lock()
				workloads = append(workloads, items...)
				workloadsMu.Unlock()
			}
			return nil
		},
		func(context.Context) error {
			details, err := NewStatefulSetService(deps).StatefulSets(namespace)
			if err != nil {
				logger.Warn(fmt.Sprintf("Failed to list StatefulSets in namespace %s: %v", namespace, err), "ResourceLoader")
				return nil
			}
			items := make([]*WorkloadInfo, 0, len(details))
			for _, detail := range details {
				items = append(items, buildStatefulSetWorkload(detail))
			}
			if len(items) > 0 {
				workloadsMu.Lock()
				workloads = append(workloads, items...)
				workloadsMu.Unlock()
			}
			return nil
		},
		func(context.Context) error {
			details, err := NewDaemonSetService(deps).DaemonSets(namespace)
			if err != nil {
				logger.Warn(fmt.Sprintf("Failed to list DaemonSets in namespace %s: %v", namespace, err), "ResourceLoader")
				return nil
			}
			items := make([]*WorkloadInfo, 0, len(details))
			for _, detail := range details {
				items = append(items, buildDaemonSetWorkload(detail))
			}
			if len(items) > 0 {
				workloadsMu.Lock()
				workloads = append(workloads, items...)
				workloadsMu.Unlock()
			}
			return nil
		},
		func(context.Context) error {
			details, err := NewJobService(deps).Jobs(namespace)
			if err != nil {
				logger.Warn(fmt.Sprintf("Failed to list Jobs in namespace %s: %v", namespace, err), "ResourceLoader")
				return nil
			}
			items := make([]*WorkloadInfo, 0, len(details))
			for _, detail := range details {
				items = append(items, buildJobWorkload(detail))
			}
			if len(items) > 0 {
				workloadsMu.Lock()
				workloads = append(workloads, items...)
				workloadsMu.Unlock()
			}
			return nil
		},
		func(context.Context) error {
			details, err := NewCronJobService(deps).CronJobs(namespace)
			if err != nil {
				logger.Warn(fmt.Sprintf("Failed to list CronJobs in namespace %s: %v", namespace, err), "ResourceLoader")
				return nil
			}
			items := make([]*WorkloadInfo, 0, len(details))
			for _, detail := range details {
				items = append(items, buildCronJobWorkload(detail))
			}
			if len(items) > 0 {
				workloadsMu.Lock()
				workloads = append(workloads, items...)
				workloadsMu.Unlock()
			}
			return nil
		},
	}

	if err := parallel.RunLimited(deps.Context, 0, tasks...); err != nil {
		return nil, err
	}

	sort.Slice(workloads, func(i, j int) bool {
		if workloads[i].Namespace == workloads[j].Namespace {
			if workloads[i].Kind == workloads[j].Kind {
				return workloads[i].Name < workloads[j].Name
			}
			return workloads[i].Kind < workloads[j].Kind
		}
		return workloads[i].Namespace < workloads[j].Namespace
	})

	logger.Info(fmt.Sprintf("Loaded %d workloads for namespace %s in %v", len(workloads), namespace, time.Since(startTime)), "ResourceLoader")
	return workloads, nil
}

func buildDeploymentWorkload(detail *restypes.DeploymentDetails) *WorkloadInfo {
	summary := detail.PodMetricsSummary
	return &WorkloadInfo{
		Kind:       detail.Kind,
		Name:       detail.Name,
		Namespace:  detail.Namespace,
		Ready:      detail.Ready,
		Status:     deploymentWorkloadStatus(detail),
		Restarts:   sumPodRestarts(detail.Pods),
		Age:        detail.Age,
		CPURequest: metricsValue(summary, summaryField(summary, func(s *restypes.PodMetricsSummary) string { return s.CPURequest })),
		CPULimit:   metricsValue(summary, summaryField(summary, func(s *restypes.PodMetricsSummary) string { return s.CPULimit })),
		CPUUsage:   metricsValue(summary, summaryField(summary, func(s *restypes.PodMetricsSummary) string { return s.CPUUsage })),
		MemRequest: metricsValue(summary, summaryField(summary, func(s *restypes.PodMetricsSummary) string { return s.MemRequest })),
		MemLimit:   metricsValue(summary, summaryField(summary, func(s *restypes.PodMetricsSummary) string { return s.MemLimit })),
		MemUsage:   metricsValue(summary, summaryField(summary, func(s *restypes.PodMetricsSummary) string { return s.MemUsage })),
	}
}

func buildStatefulSetWorkload(detail *restypes.StatefulSetDetails) *WorkloadInfo {
	summary := detail.PodMetricsSummary
	return &WorkloadInfo{
		Kind:       detail.Kind,
		Name:       detail.Name,
		Namespace:  detail.Namespace,
		Ready:      detail.Ready,
		Status:     statefulSetWorkloadStatus(detail),
		Restarts:   sumPodRestarts(detail.Pods),
		Age:        detail.Age,
		CPURequest: metricsValue(summary, summaryField(summary, func(s *restypes.PodMetricsSummary) string { return s.CPURequest })),
		CPULimit:   metricsValue(summary, summaryField(summary, func(s *restypes.PodMetricsSummary) string { return s.CPULimit })),
		CPUUsage:   metricsValue(summary, summaryField(summary, func(s *restypes.PodMetricsSummary) string { return s.CPUUsage })),
		MemRequest: metricsValue(summary, summaryField(summary, func(s *restypes.PodMetricsSummary) string { return s.MemRequest })),
		MemLimit:   metricsValue(summary, summaryField(summary, func(s *restypes.PodMetricsSummary) string { return s.MemLimit })),
		MemUsage:   metricsValue(summary, summaryField(summary, func(s *restypes.PodMetricsSummary) string { return s.MemUsage })),
	}
}

func buildDaemonSetWorkload(detail *restypes.DaemonSetDetails) *WorkloadInfo {
	summary := detail.PodMetricsSummary
	return &WorkloadInfo{
		Kind:       detail.Kind,
		Name:       detail.Name,
		Namespace:  detail.Namespace,
		Ready:      fmt.Sprintf("%d/%d", detail.Ready, detail.Desired),
		Status:     daemonSetWorkloadStatus(detail),
		Restarts:   sumPodRestarts(detail.Pods),
		Age:        detail.Age,
		CPURequest: metricsValue(summary, summaryField(summary, func(s *restypes.PodMetricsSummary) string { return s.CPURequest })),
		CPULimit:   metricsValue(summary, summaryField(summary, func(s *restypes.PodMetricsSummary) string { return s.CPULimit })),
		CPUUsage:   metricsValue(summary, summaryField(summary, func(s *restypes.PodMetricsSummary) string { return s.CPUUsage })),
		MemRequest: metricsValue(summary, summaryField(summary, func(s *restypes.PodMetricsSummary) string { return s.MemRequest })),
		MemLimit:   metricsValue(summary, summaryField(summary, func(s *restypes.PodMetricsSummary) string { return s.MemLimit })),
		MemUsage:   metricsValue(summary, summaryField(summary, func(s *restypes.PodMetricsSummary) string { return s.MemUsage })),
	}
}

func buildJobWorkload(detail *restypes.JobDetails) *WorkloadInfo {
	summary := detail.PodMetricsSummary
	return &WorkloadInfo{
		Kind:       detail.Kind,
		Name:       detail.Name,
		Namespace:  detail.Namespace,
		Ready:      fmt.Sprintf("%d/%d", detail.Succeeded, detail.Completions),
		Status:     detail.Status,
		Restarts:   sumPodRestarts(detail.Pods),
		Age:        detail.Age,
		CPURequest: metricsValue(summary, summaryField(summary, func(s *restypes.PodMetricsSummary) string { return s.CPURequest })),
		CPULimit:   metricsValue(summary, summaryField(summary, func(s *restypes.PodMetricsSummary) string { return s.CPULimit })),
		CPUUsage:   metricsValue(summary, summaryField(summary, func(s *restypes.PodMetricsSummary) string { return s.CPUUsage })),
		MemRequest: metricsValue(summary, summaryField(summary, func(s *restypes.PodMetricsSummary) string { return s.MemRequest })),
		MemLimit:   metricsValue(summary, summaryField(summary, func(s *restypes.PodMetricsSummary) string { return s.MemLimit })),
		MemUsage:   metricsValue(summary, summaryField(summary, func(s *restypes.PodMetricsSummary) string { return s.MemUsage })),
	}
}

func buildCronJobWorkload(detail *restypes.CronJobDetails) *WorkloadInfo {
	return &WorkloadInfo{
		Kind:      detail.Kind,
		Name:      detail.Name,
		Namespace: detail.Namespace,
		Ready:     fmt.Sprintf("%d", len(detail.ActiveJobs)),
		Status:    cronJobWorkloadStatus(detail),
		Restarts:  0,
		Age:       detail.Age,
	}
}

func deploymentWorkloadStatus(detail *restypes.DeploymentDetails) string {
	if detail == nil {
		return "Unknown"
	}
	_, desired := parseReadyStatus(detail.Replicas)
	if detail.DesiredReplicas > 0 {
		desired = int(detail.DesiredReplicas)
	}
	ready, _ := parseReadyStatus(detail.Ready)
	if desired == 0 {
		return "Scaled to 0"
	}
	if ready >= desired && desired > 0 {
		return "Running"
	}
	if ready > 0 {
		return "Updating"
	}
	return "Pending"
}

func statefulSetWorkloadStatus(detail *restypes.StatefulSetDetails) string {
	if detail == nil {
		return "Unknown"
	}
	_, desired := parseReadyStatus(detail.Replicas)
	if detail.DesiredReplicas > 0 {
		desired = int(detail.DesiredReplicas)
	}
	ready, _ := parseReadyStatus(detail.Ready)
	if desired == 0 {
		return "Scaled to 0"
	}
	if ready >= desired && desired > 0 {
		return "Running"
	}
	if ready > 0 {
		return "Updating"
	}
	return "Pending"
}

func daemonSetWorkloadStatus(detail *restypes.DaemonSetDetails) string {
	if detail == nil {
		return "Unknown"
	}
	if detail.Desired == 0 {
		return "Scaled to 0"
	}
	if detail.Ready == detail.Desired {
		return "Running"
	}
	if detail.Ready > 0 {
		return "Updating"
	}
	return "Pending"
}

func cronJobWorkloadStatus(detail *restypes.CronJobDetails) string {
	if detail == nil {
		return "Unknown"
	}
	if detail.Suspend {
		return "Suspended"
	}
	if len(detail.ActiveJobs) > 0 {
		return "Active"
	}
	return "Idle"
}

func summaryField(summary *restypes.PodMetricsSummary, extractor func(*restypes.PodMetricsSummary) string) string {
	if summary == nil {
		return ""
	}
	return extractor(summary)
}

func metricsValue(summary *restypes.PodMetricsSummary, value string) string {
	if summary == nil || value == "" {
		return "-"
	}
	return value
}

func sumPodRestarts(pods []restypes.PodSimpleInfo) int32 {
	var total int32
	for i := range pods {
		total += pods[i].Restarts
	}
	return total
}
