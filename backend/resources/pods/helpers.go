package pods

import (
	"context"
	"fmt"
	"sync"

	"github.com/luxury-yacht/app/backend/internal/parallel"
	"github.com/luxury-yacht/app/backend/resources/common"
	restypes "github.com/luxury-yacht/app/backend/resources/types"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	metricsv1beta1 "k8s.io/metrics/pkg/apis/metrics/v1beta1"
	metricsclient "k8s.io/metrics/pkg/client/clientset/versioned"
)

// Local aliases for shared pod detail types.
type PodDetailInfo = restypes.PodDetailInfo
type PodDetailInfoContainer = restypes.PodDetailInfoContainer

// Helper to fetch a single pod with full details
func (s *Service) fetchSinglePodFull(namespace, name string) (*restypes.PodDetailInfo, error) {
	pod, err := s.deps.Common.KubernetesClient.CoreV1().Pods(namespace).Get(s.deps.Common.Context, name, metav1.GetOptions{})
	if err != nil {
		s.deps.Common.Logger.Error(fmt.Sprintf("Failed to fetch pod %s/%s from Kubernetes API: %v", namespace, name, err), "Pod")
		return nil, fmt.Errorf("failed to fetch pod from API: %w", err)
	}
	s.deps.Common.Logger.Debug(fmt.Sprintf("Fetched pod %s/%s from Kubernetes API", namespace, name), "Pod")

	// Get metrics and owner info
	podMetrics := s.getPodMetrics(namespace)
	rsToDeployment := s.buildReplicaSetToDeploymentMap(namespace)

	// Build full details
	details := s.buildPodDetailInfo(*pod, podMetrics, rsToDeployment)

	// Add node IP
	if pod.Spec.NodeName != "" {
		details.NodeIP = s.getNodeIP(pod.Spec.NodeName)
	}

	// Add containers
	for i, container := range pod.Spec.Containers {
		details.Containers = append(details.Containers, buildContainerDetails(container, pod.Status.ContainerStatuses, i))
	}
	for i, container := range pod.Spec.InitContainers {
		details.InitContainers = append(details.InitContainers, buildContainerDetails(container, pod.Status.InitContainerStatuses, i))
	}

	// Add formatted fields
	details.Conditions = formatPodConditions(pod.Status.Conditions)
	details.Volumes = formatPodVolumes(pod.Spec.Volumes)
	details.Tolerations = formatPodTolerations(pod.Spec.Tolerations)
	details.Affinity = buildAffinityMap(pod.Spec.Affinity)
	details.SecurityContext = buildSecurityContextMap(pod.Spec.SecurityContext)

	if pod.Spec.RuntimeClassName != nil {
		details.RuntimeClass = *pod.Spec.RuntimeClassName
	}

	return details, nil
}

// Helper to get multi-namespace pod metrics
// Optimized version that batches metrics fetching
func (s *Service) getMultiNamespacePodMetrics(pods []corev1.Pod) map[string]*metricsv1beta1.PodMetrics {
	metrics := make(map[string]*metricsv1beta1.PodMetrics)

	// Ensure metrics client is available
	client := s.deps.Common.MetricsClient
	if client == nil {
		config := s.deps.Common.RestConfig
		if config != nil {
			metricsClient, err := metricsclient.NewForConfig(config)
			if err != nil {
				s.deps.Common.Logger.Debug(fmt.Sprintf("Metrics client not available: %v", err), "ResourceLoader")
				return metrics
			}
			s.deps.Common.SetMetricsClient(metricsClient)
			s.deps.Common.MetricsClient = metricsClient
			client = metricsClient
		} else {
			return metrics
		}
	}

	// Get unique namespaces
	namespaces := make(map[string]bool)
	for _, pod := range pods {
		namespaces[pod.Namespace] = true
	}

	nsList := make([]string, 0, len(namespaces))
	for ns := range namespaces {
		nsList = append(nsList, ns)
	}

	var mu sync.Mutex

	_ = parallel.ForEach(s.deps.Common.Context, nsList, 4, func(ctx context.Context, ns string) error {
		podMetricsList, err := client.MetricsV1beta1().PodMetricses(ns).List(ctx, metav1.ListOptions{})
		if err != nil {
			s.deps.Common.Logger.Debug(fmt.Sprintf("Failed to fetch pod metrics for namespace %s: %v", ns, err), "ResourceLoader")
			return nil
		}

		local := make(map[string]*metricsv1beta1.PodMetrics, len(podMetricsList.Items))
		for i := range podMetricsList.Items {
			pod := &podMetricsList.Items[i]
			local[pod.Name] = pod
		}

		if len(local) == 0 {
			return nil
		}

		mu.Lock()
		for name, metric := range local {
			metrics[name] = metric
		}
		mu.Unlock()
		return nil
	})

	return metrics
}

// Helper functions for simplified pod handling

// buildReplicaSetToDeploymentMap builds a map of ReplicaSet names to Deployment names.
func (s *Service) buildReplicaSetToDeploymentMap(namespace string) map[string]string {
	rsToDeployment := make(map[string]string)

	rsList, err := s.deps.Common.KubernetesClient.AppsV1().ReplicaSets(namespace).List(s.deps.Common.Context, metav1.ListOptions{})
	if err != nil {
		return rsToDeployment
	}

	for _, rs := range rsList.Items {
		for _, owner := range rs.OwnerReferences {
			if owner.Controller != nil && *owner.Controller && owner.Kind == "Deployment" {
				rsToDeployment[rs.Name] = owner.Name
				break
			}
		}
	}

	return rsToDeployment
}

// getPodOwnerWithMap gets pod owner using pre-fetched ReplicaSet map
func getPodOwnerWithMap(pod corev1.Pod, rsToDeployment map[string]string) (string, string) {
	for _, owner := range pod.OwnerReferences {
		if owner.Controller != nil && *owner.Controller {
			if owner.Kind == "ReplicaSet" {
				if deploymentName, ok := rsToDeployment[owner.Name]; ok {
					return "Deployment", deploymentName
				}
			}
			return owner.Kind, owner.Name
		}
	}
	return "None", "None"
}

// getNodeIP retrieves the internal IP address for the given node, returning an empty
// string if the lookup fails.
func (s *Service) getNodeIP(nodeName string) string {
	if nodeName == "" {
		return ""
	}

	node, err := s.deps.Common.KubernetesClient.CoreV1().Nodes().Get(s.deps.Common.Context, nodeName, metav1.GetOptions{})
	if err != nil {
		return ""
	}

	var nodeIP string
	for _, addr := range node.Status.Addresses {
		if addr.Type == corev1.NodeInternalIP {
			nodeIP = addr.Address
			break
		}
	}

	return nodeIP
}

// buildPodDetailInfo creates comprehensive PodDetailInfo from a pod
func (s *Service) buildPodDetailInfo(pod corev1.Pod, podMetrics map[string]*metricsv1beta1.PodMetrics, rsToDeployment map[string]string) *restypes.PodDetailInfo {
	// Calculate resources
	cpuRequest, cpuLimit, memRequest, memLimit := calculatePodResources(pod)

	// Get metrics
	cpuUsage, memUsage := getPodUsageFromMetrics(pod.Name, podMetrics)

	// Get owner
	ownerKind, ownerName := getPodOwnerWithMap(pod, rsToDeployment)

	// Get status
	status := getPodStatus(pod)

	return &restypes.PodDetailInfo{
		// Basic info
		Name:       pod.Name,
		Namespace:  pod.Namespace,
		Status:     status,
		Ready:      getNsPodReadyStatus(pod),
		Restarts:   getPodRestartCount(pod),
		Age:        common.FormatAge(pod.CreationTimestamp.Time),
		CPURequest: common.FormatCPU(cpuRequest),
		CPULimit:   common.FormatCPU(cpuLimit),
		CPUUsage:   common.FormatCPU(cpuUsage),
		MemRequest: common.FormatMemory(memRequest),
		MemLimit:   common.FormatMemory(memLimit),
		MemUsage:   common.FormatMemory(memUsage),

		// Ownership
		OwnerKind: ownerKind,
		OwnerName: ownerName,

		// Node info
		Node:  pod.Spec.NodeName,
		PodIP: pod.Status.PodIP,

		// Pod metadata
		QOSClass:       string(pod.Status.QOSClass),
		Priority:       pod.Spec.Priority,
		PriorityClass:  pod.Spec.PriorityClassName,
		ServiceAccount: pod.Spec.ServiceAccountName,
		Labels:         pod.Labels,
		Annotations:    pod.Annotations,

		// Pod spec
		HostNetwork:   pod.Spec.HostNetwork,
		HostPID:       pod.Spec.HostPID,
		HostIPC:       pod.Spec.HostIPC,
		DNSPolicy:     string(pod.Spec.DNSPolicy),
		RestartPolicy: string(pod.Spec.RestartPolicy),
		SchedulerName: pod.Spec.SchedulerName,

		// Will be populated later
		Containers:     []PodDetailInfoContainer{},
		InitContainers: []PodDetailInfoContainer{},
		Volumes:        []string{},
		Conditions:     []string{},
		Tolerations:    []string{},
	}
}

// calculatePodResources aggregates CPU and memory requests/limits for all containers
func calculatePodResources(pod corev1.Pod) (*resource.Quantity, *resource.Quantity, *resource.Quantity, *resource.Quantity) {
	cpuReq := resource.NewQuantity(0, resource.DecimalSI)
	cpuLim := resource.NewQuantity(0, resource.DecimalSI)
	memReq := resource.NewQuantity(0, resource.BinarySI)
	memLim := resource.NewQuantity(0, resource.BinarySI)

	// Helper to add resources
	addResources := func(resources corev1.ResourceRequirements, addToReq, addToLim bool) {
		if addToReq && resources.Requests != nil {
			if cpu, ok := resources.Requests[corev1.ResourceCPU]; ok {
				cpuReq.Add(cpu)
			}
			if mem, ok := resources.Requests[corev1.ResourceMemory]; ok {
				memReq.Add(mem)
			}
		}
		if addToLim && resources.Limits != nil {
			if cpu, ok := resources.Limits[corev1.ResourceCPU]; ok {
				cpuLim.Add(cpu)
			}
			if mem, ok := resources.Limits[corev1.ResourceMemory]; ok {
				memLim.Add(mem)
			}
		}
	}

	// Aggregate resources from all containers
	for _, container := range pod.Spec.Containers {
		addResources(container.Resources, true, true)
	}

	// For init containers, take the max (they run sequentially)
	var maxInitCPUReq, maxInitCPULim, maxInitMemReq, maxInitMemLim resource.Quantity
	for _, container := range pod.Spec.InitContainers {
		if container.Resources.Requests != nil {
			if cpu, ok := container.Resources.Requests[corev1.ResourceCPU]; ok {
				if cpu.Cmp(maxInitCPUReq) > 0 {
					maxInitCPUReq = cpu
				}
			}
			if mem, ok := container.Resources.Requests[corev1.ResourceMemory]; ok {
				if mem.Cmp(maxInitMemReq) > 0 {
					maxInitMemReq = mem
				}
			}
		}
		if container.Resources.Limits != nil {
			if cpu, ok := container.Resources.Limits[corev1.ResourceCPU]; ok {
				if cpu.Cmp(maxInitCPULim) > 0 {
					maxInitCPULim = cpu
				}
			}
			if mem, ok := container.Resources.Limits[corev1.ResourceMemory]; ok {
				if mem.Cmp(maxInitMemLim) > 0 {
					maxInitMemLim = mem
				}
			}
		}
	}

	// Use max of init containers if greater than sum of containers
	if maxInitCPUReq.Cmp(*cpuReq) > 0 {
		cpuReq = &maxInitCPUReq
	}
	if maxInitCPULim.Cmp(*cpuLim) > 0 {
		cpuLim = &maxInitCPULim
	}
	if maxInitMemReq.Cmp(*memReq) > 0 {
		memReq = &maxInitMemReq
	}
	if maxInitMemLim.Cmp(*memLim) > 0 {
		memLim = &maxInitMemLim
	}

	return cpuReq, cpuLim, memReq, memLim
}

// getPodMetrics fetches metrics from the metrics-server API
func (s *Service) getPodMetrics(namespace string) map[string]*metricsv1beta1.PodMetrics {
	metrics := make(map[string]*metricsv1beta1.PodMetrics)

	client := s.deps.Common.MetricsClient
	if client == nil {
		config := s.deps.Common.RestConfig
		if config != nil {
			metricsClient, err := metricsclient.NewForConfig(config)
			if err != nil {
				s.deps.Common.Logger.Info(fmt.Sprintf("Metrics client not available: %v", err), "ResourceLoader")
				return metrics
			}
			s.deps.Common.SetMetricsClient(metricsClient)
			s.deps.Common.MetricsClient = metricsClient
			client = metricsClient
		} else {
			return metrics
		}
	}

	// Fetch pod metrics
	podMetricsList, err := client.MetricsV1beta1().PodMetricses(namespace).List(s.deps.Common.Context, metav1.ListOptions{})
	if err != nil {
		s.deps.Common.Logger.Info(fmt.Sprintf("Failed to fetch pod metrics for namespace %s: %v", namespace, err), "ResourceLoader")
		return metrics
	}

	// Build map for easy lookup
	for i := range podMetricsList.Items {
		pod := &podMetricsList.Items[i]
		metrics[pod.Name] = pod
	}

	// Log moved to callers to avoid duplicate messages
	// The log was causing duplicate messages when multiple workload types fetch metrics

	return metrics
}

// getPodMetricsForPods fetches metrics only for specific pods
func (s *Service) getPodMetricsForPods(namespace string, pods []corev1.Pod) map[string]*metricsv1beta1.PodMetrics {
	metrics := make(map[string]*metricsv1beta1.PodMetrics)

	if len(pods) == 0 {
		return metrics
	}

	client := s.deps.Common.MetricsClient
	if client == nil {
		config := s.deps.Common.RestConfig
		if config != nil {
			metricsClient, err := metricsclient.NewForConfig(config)
			if err != nil {
				s.deps.Common.Logger.Debug(fmt.Sprintf("Metrics client not available: %v", err), "ResourceLoader")
				return metrics
			}
			s.deps.Common.SetMetricsClient(metricsClient)
			s.deps.Common.MetricsClient = metricsClient
			client = metricsClient
		} else {
			return metrics
		}
	}

	// For small numbers of pods, fetch individually
	// For larger numbers, it's more efficient to fetch all and filter
	if len(pods) <= 3 {
		// Fetch metrics individually
		for _, pod := range pods {
			podMetric, err := client.MetricsV1beta1().PodMetricses(namespace).Get(s.deps.Common.Context, pod.Name, metav1.GetOptions{})
			if err != nil {
				// Individual pod metrics might not be available yet (new pods)
				s.deps.Common.Logger.Debug(fmt.Sprintf("No metrics for pod %s: %v", pod.Name, err), "ResourceLoader")
				continue
			}
			metrics[pod.Name] = podMetric
		}
	} else {
		// For many pods, fetch all and filter
		podMetricsList, err := client.MetricsV1beta1().PodMetricses(namespace).List(s.deps.Common.Context, metav1.ListOptions{})
		if err != nil {
			s.deps.Common.Logger.Info(fmt.Sprintf("Failed to fetch pod metrics for namespace %s: %v", namespace, err), "ResourceLoader")
			return metrics
		}

		// Create a map of pod names for quick lookup
		podNames := make(map[string]bool)
		for _, pod := range pods {
			podNames[pod.Name] = true
		}

		// Only include metrics for our pods
		for i := range podMetricsList.Items {
			pod := &podMetricsList.Items[i]
			if podNames[pod.Name] {
				metrics[pod.Name] = pod
			}
		}
	}

	return metrics
}

// getPodUsageFromMetrics extracts current CPU and memory usage from metrics
func getPodUsageFromMetrics(podName string, metrics map[string]*metricsv1beta1.PodMetrics) (cpuUsage, memUsage *resource.Quantity) {
	cpuUse := resource.NewQuantity(0, resource.DecimalSI)
	memUse := resource.NewQuantity(0, resource.BinarySI)

	podMetrics, exists := metrics[podName]
	if !exists {
		return cpuUse, memUse
	}

	// Aggregate usage from all containers
	for _, container := range podMetrics.Containers {
		if cpu, ok := container.Usage[corev1.ResourceCPU]; ok {
			cpuUse.Add(cpu)
		}
		if mem, ok := container.Usage[corev1.ResourceMemory]; ok {
			memUse.Add(mem)
		}
	}

	return cpuUse, memUse
}

// getNsPodReadyStatus calculates ready/total containers
func getNsPodReadyStatus(pod corev1.Pod) string {
	ready := 0
	total := len(pod.Status.ContainerStatuses)

	for _, status := range pod.Status.ContainerStatuses {
		if status.Ready {
			ready++
		}
	}

	return fmt.Sprintf("%d/%d", ready, total)
}

// getPodStatus returns the pod status similar to kubectl's display logic
// It checks container states to provide more specific status information
func getPodStatus(pod corev1.Pod) string {
	// Check if pod was evicted (Failed phase with Evicted reason)
	if pod.Status.Phase == corev1.PodFailed && pod.Status.Reason == "Evicted" {
		return "Evicted"
	}

	// Check init container statuses first
	for _, status := range pod.Status.InitContainerStatuses {
		if status.State.Terminated != nil && status.State.Terminated.ExitCode != 0 {
			if status.State.Terminated.Reason != "" {
				return "Init:" + status.State.Terminated.Reason
			}
			return "Init:Error"
		}
		if status.State.Waiting != nil && status.State.Waiting.Reason != "" && status.State.Waiting.Reason != "PodInitializing" {
			return "Init:" + status.State.Waiting.Reason
		}
	}

	// Check regular container statuses
	for _, status := range pod.Status.ContainerStatuses {
		if status.State.Waiting != nil && status.State.Waiting.Reason != "" {
			return status.State.Waiting.Reason
		}
		if status.State.Terminated != nil && status.State.Terminated.Reason != "" {
			return status.State.Terminated.Reason
		}
	}

	// Check if pod is being deleted
	if pod.DeletionTimestamp != nil {
		return "Terminating"
	}

	// Fall back to pod phase
	if pod.Status.Phase != "" {
		return string(pod.Status.Phase)
	}

	return "Unknown"
}

// getPodRestartCount calculates the total restart count across all containers
func getPodRestartCount(pod corev1.Pod) int32 {
	var totalRestarts int32 = 0

	// Count restarts from regular containers
	for _, containerStatus := range pod.Status.ContainerStatuses {
		totalRestarts += containerStatus.RestartCount
	}

	// Count restarts from init containers
	for _, initContainerStatus := range pod.Status.InitContainerStatuses {
		totalRestarts += initContainerStatus.RestartCount
	}

	// Count restarts from ephemeral containers (if any)
	for _, ephemeralContainerStatus := range pod.Status.EphemeralContainerStatuses {
		totalRestarts += ephemeralContainerStatus.RestartCount
	}

	return totalRestarts
}

// formatPodConditions formats pod conditions for display
func formatPodConditions(conditions []corev1.PodCondition) []string {
	result := make([]string, 0, len(conditions))
	for _, cond := range conditions {
		condStr := fmt.Sprintf("%s: %s", cond.Type, cond.Status)
		if cond.Reason != "" {
			condStr += fmt.Sprintf(" (%s)", cond.Reason)
		}
		result = append(result, condStr)
	}
	return result
}

// formatPodVolumes formats pod volumes for display
func formatPodVolumes(volumes []corev1.Volume) []string {
	result := make([]string, 0, len(volumes))
	for _, vol := range volumes {
		volStr := vol.Name
		switch {
		case vol.ConfigMap != nil:
			volStr += fmt.Sprintf(" (ConfigMap: %s)", vol.ConfigMap.Name)
		case vol.Secret != nil:
			volStr += fmt.Sprintf(" (Secret: %s)", vol.Secret.SecretName)
		case vol.PersistentVolumeClaim != nil:
			volStr += fmt.Sprintf(" (PVC: %s)", vol.PersistentVolumeClaim.ClaimName)
		case vol.EmptyDir != nil:
			volStr += " (EmptyDir)"
		case vol.HostPath != nil:
			volStr += fmt.Sprintf(" (HostPath: %s)", vol.HostPath.Path)
		}
		result = append(result, volStr)
	}
	return result
}

// formatPodTolerations formats pod tolerations for display
func formatPodTolerations(tolerations []corev1.Toleration) []string {
	result := make([]string, 0, len(tolerations))
	for _, tol := range tolerations {
		tolStr := ""
		if tol.Key != "" {
			tolStr = tol.Key
			if tol.Operator != "" {
				tolStr += fmt.Sprintf(" %s", tol.Operator)
			}
			if tol.Value != "" {
				tolStr += fmt.Sprintf(" %s", tol.Value)
			}
		} else if tol.Operator == corev1.TolerationOpExists {
			tolStr = "Exists"
		}
		if tol.Effect != "" {
			tolStr += fmt.Sprintf(" (%s)", tol.Effect)
		}
		if tol.TolerationSeconds != nil {
			tolStr += fmt.Sprintf(" for %ds", *tol.TolerationSeconds)
		}
		result = append(result, tolStr)
	}
	return result
}

// buildAffinityMap builds affinity map for display
func buildAffinityMap(affinity *corev1.Affinity) map[string]any {
	if affinity == nil {
		return nil
	}
	result := make(map[string]any)
	if affinity.NodeAffinity != nil {
		result["nodeAffinity"] = "configured"
	}
	if affinity.PodAffinity != nil {
		result["podAffinity"] = "configured"
	}
	if affinity.PodAntiAffinity != nil {
		result["podAntiAffinity"] = "configured"
	}
	return result
}

// buildSecurityContextMap builds security context map for display
func buildSecurityContextMap(sc *corev1.PodSecurityContext) map[string]any {
	if sc == nil {
		return nil
	}
	result := make(map[string]any)
	if sc.RunAsUser != nil {
		result["runAsUser"] = *sc.RunAsUser
	}
	if sc.RunAsGroup != nil {
		result["runAsGroup"] = *sc.RunAsGroup
	}
	if sc.FSGroup != nil {
		result["fsGroup"] = *sc.FSGroup
	}
	if sc.RunAsNonRoot != nil {
		result["runAsNonRoot"] = *sc.RunAsNonRoot
	}
	return result
}

// buildContainerDetails builds detailed container information
func buildContainerDetails(container corev1.Container, statuses []corev1.ContainerStatus, index int) restypes.PodDetailInfoContainer {
	detail := restypes.PodDetailInfoContainer{
		Name:            container.Name,
		Image:           container.Image,
		ImagePullPolicy: string(container.ImagePullPolicy),
		Command:         container.Command,
		Args:            container.Args,
	}

	// Get resources
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

	// Get ports
	if len(container.Ports) > 0 {
		detail.Ports = make([]string, 0, len(container.Ports))
		for _, port := range container.Ports {
			portStr := fmt.Sprintf("%d", port.ContainerPort)
			if port.Name != "" {
				portStr = fmt.Sprintf("%s (%s)", portStr, port.Name)
			}
			if port.Protocol != "" && port.Protocol != corev1.ProtocolTCP {
				portStr += fmt.Sprintf("/%s", port.Protocol)
			}
			detail.Ports = append(detail.Ports, portStr)
		}
	}

	// Get volume mounts
	if len(container.VolumeMounts) > 0 {
		detail.VolumeMounts = make([]string, 0, len(container.VolumeMounts))
		for _, mount := range container.VolumeMounts {
			mountStr := fmt.Sprintf("%s -> %s", mount.Name, mount.MountPath)
			if mount.ReadOnly {
				mountStr += " (ro)"
			}
			if mount.SubPath != "" {
				mountStr += fmt.Sprintf(" [%s]", mount.SubPath)
			}
			detail.VolumeMounts = append(detail.VolumeMounts, mountStr)
		}
	}

	// Get environment variables (simplified - just name=value or name from source)
	if len(container.Env) > 0 {
		detail.Environment = make(map[string]string)
		for _, env := range container.Env {
			if env.Value != "" {
				detail.Environment[env.Name] = env.Value
			} else if env.ValueFrom != nil {
				if env.ValueFrom.ConfigMapKeyRef != nil {
					detail.Environment[env.Name] = fmt.Sprintf("configmap:%s/%s",
						env.ValueFrom.ConfigMapKeyRef.Name,
						env.ValueFrom.ConfigMapKeyRef.Key)
				} else if env.ValueFrom.SecretKeyRef != nil {
					detail.Environment[env.Name] = fmt.Sprintf("secret:%s/%s",
						env.ValueFrom.SecretKeyRef.Name,
						env.ValueFrom.SecretKeyRef.Key)
				} else if env.ValueFrom.FieldRef != nil {
					detail.Environment[env.Name] = fmt.Sprintf("field:%s", env.ValueFrom.FieldRef.FieldPath)
				}
			}
		}
	}

	// Get container status if available
	if index < len(statuses) {
		status := statuses[index]
		detail.Ready = status.Ready
		detail.RestartCount = status.RestartCount

		// Determine container state
		if status.State.Running != nil {
			detail.State = "running"
			if !status.State.Running.StartedAt.IsZero() {
				detail.StartedAt = common.FormatAge(status.State.Running.StartedAt.Time)
			}
		} else if status.State.Waiting != nil {
			detail.State = "waiting"
			detail.StateReason = status.State.Waiting.Reason
			detail.StateMessage = status.State.Waiting.Message
		} else if status.State.Terminated != nil {
			detail.State = "terminated"
			detail.StateReason = status.State.Terminated.Reason
			detail.StateMessage = status.State.Terminated.Message
		}
	}

	return detail
}

// fetchPodsWithFilter fetches pods with the given filters
func (s *Service) fetchPodsWithFilter(namespace string, listOptions metav1.ListOptions) ([]corev1.Pod, error) {
	if namespace != "" {
		podList, err := s.deps.Common.KubernetesClient.CoreV1().Pods(namespace).List(s.deps.Common.Context, listOptions)
		if err != nil {
			return nil, fmt.Errorf("failed to list pods: %v", err)
		}
		return podList.Items, nil
	}

	// Fetch from all namespaces
	podList, err := s.deps.Common.KubernetesClient.CoreV1().Pods("").List(s.deps.Common.Context, listOptions)
	if err != nil {
		return nil, fmt.Errorf("failed to list pods: %v", err)
	}
	return podList.Items, nil
}

// buildMultiNamespaceRSMap builds ReplicaSet to Deployment mapping for multiple namespaces
// Optimized version that batches ReplicaSet fetching
func (s *Service) buildMultiNamespaceRSMap(pods []corev1.Pod) map[string]string {
	// Get unique namespaces
	namespaces := make(map[string]bool)
	for _, pod := range pods {
		namespaces[pod.Namespace] = true
	}

	// Build combined map - use ReplicaSet name as key since it's unique per namespace
	rsToDeployment := make(map[string]string)
	for ns := range namespaces {
		rsList, err := s.deps.Common.KubernetesClient.AppsV1().ReplicaSets(ns).List(s.deps.Common.Context, metav1.ListOptions{})
		if err != nil {
			s.deps.Common.Logger.Debug(fmt.Sprintf("Failed to fetch ReplicaSets for namespace %s: %v", ns, err), "ResourceLoader")
			continue
		}

		for _, rs := range rsList.Items {
			for _, owner := range rs.OwnerReferences {
				if owner.Controller != nil && *owner.Controller && owner.Kind == "Deployment" {
					rsToDeployment[rs.Name] = owner.Name
					break
				}
			}
		}
	}

	return rsToDeployment
}

// CalculatePodResources aggregates CPU and memory metrics for a pod.
func CalculatePodResources(pod corev1.Pod) (*resource.Quantity, *resource.Quantity, *resource.Quantity, *resource.Quantity) {
	return calculatePodResources(pod)
}

// PodUsageFromMetrics extracts CPU and memory usage for a pod from metrics data.
func PodUsageFromMetrics(podName string, metrics map[string]*metricsv1beta1.PodMetrics) (*resource.Quantity, *resource.Quantity) {
	return getPodUsageFromMetrics(podName, metrics)
}

// PodReadyStatus formats the ready container status for list views.
func PodReadyStatus(pod corev1.Pod) string {
	return getNsPodReadyStatus(pod)
}

// PodRestartCount returns total restart count across containers.
func PodRestartCount(pod corev1.Pod) int32 {
	return getPodRestartCount(pod)
}

// PodStatus returns a human-friendly status string mirroring kubectl logic.
func PodStatus(pod corev1.Pod) string {
	return getPodStatus(pod)
}

// GetPodMetricsForPods exposes selective pod metrics fetching for other packages.
func (s *Service) GetPodMetricsForPods(namespace string, pods []corev1.Pod) map[string]*metricsv1beta1.PodMetrics {
	return s.getPodMetricsForPods(namespace, pods)
}

// BuildReplicaSetToDeploymentMap exposes replica set ownership lookups.
func (s *Service) BuildReplicaSetToDeploymentMap(namespace string) map[string]string {
	return s.buildReplicaSetToDeploymentMap(namespace)
}

// NodeIP returns the internal node IP for a pod's node if available.
func (s *Service) NodeIP(nodeName string) string {
	return s.getNodeIP(nodeName)
}

// SummarizePod converts a pod object and optional metrics into a PodSimpleInfo for list views.
func SummarizePod(pod corev1.Pod, metrics map[string]*metricsv1beta1.PodMetrics, ownerKind, ownerName string) restypes.PodSimpleInfo {
	cpuRequest, cpuLimit, memRequest, memLimit := CalculatePodResources(pod)
	cpuUsage, memUsage := PodUsageFromMetrics(pod.Name, metrics)

	return restypes.PodSimpleInfo{
		Kind:       "Pod",
		Name:       pod.Name,
		Namespace:  pod.Namespace,
		Status:     PodStatus(pod),
		Ready:      PodReadyStatus(pod),
		Restarts:   PodRestartCount(pod),
		Age:        common.FormatAge(pod.CreationTimestamp.Time),
		CPURequest: formatCPUQuantity(cpuRequest),
		CPULimit:   formatCPUQuantity(cpuLimit),
		CPUUsage:   formatCPUQuantity(cpuUsage),
		MemRequest: formatMemoryQuantity(memRequest),
		MemLimit:   formatMemoryQuantity(memLimit),
		MemUsage:   formatMemoryQuantity(memUsage),
		OwnerKind:  ownerKind,
		OwnerName:  ownerName,
	}
}

// ResolveOwner determines the high-level owner for a pod, collapsing ReplicaSets into Deployments.
func ResolveOwner(pod corev1.Pod, rsToDeployment map[string]string) (string, string) {
	for _, owner := range pod.OwnerReferences {
		if owner.Controller != nil && *owner.Controller {
			if owner.Kind == "ReplicaSet" {
				if deploymentName, ok := rsToDeployment[owner.Name]; ok {
					return "Deployment", deploymentName
				}
			}
			return owner.Kind, owner.Name
		}
	}
	return "None", "None"
}

func formatCPUQuantity(q *resource.Quantity) string {
	if q == nil || q.IsZero() {
		return "0m"
	}
	return common.FormatCPU(q)
}

func formatMemoryQuantity(q *resource.Quantity) string {
	if q == nil || q.IsZero() {
		return "0Mi"
	}
	return common.FormatMemory(q)
}
