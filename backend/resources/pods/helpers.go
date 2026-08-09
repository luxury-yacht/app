/*
 * backend/resources/pods/helpers.go
 *
 * Pod detail and metrics helpers.
 * - Aggregates metrics, owners, and summaries.
 */

package pods

import (
	"context"
	"fmt"

	"github.com/luxury-yacht/app/backend/internal/logsources"
	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/luxury-yacht/app/backend/resources/types"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	metricsv1beta1 "k8s.io/metrics/pkg/apis/metrics/v1beta1"
	metricsclient "k8s.io/metrics/pkg/client/clientset/versioned"
)

// Local aliases for shared pod detail types.
type PodDetailInfo = types.PodDetailInfo
type PodDetailInfoContainer = types.PodDetailInfoContainer

// Helper to fetch a single pod with full details
func (s *Service) fetchSinglePodFull(ctx context.Context, namespace, name string) (*types.PodDetailInfo, error) {
	pod, err := s.deps.KubernetesClient.CoreV1().Pods(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		err = s.deps.LogResourceRequestFailure(err, fmt.Sprintf("Failed to fetch pod %s/%s from Kubernetes API", namespace, name), "get", Identity, "Pod")
		return nil, fmt.Errorf("failed to fetch pod from API: %w", err)
	}
	s.deps.Logger.Debug(fmt.Sprintf("Fetched pod %s/%s from Kubernetes API", namespace, name), "Pod")

	// Get metrics and owner info
	podMetrics := s.getPodMetrics(ctx, namespace)
	rsToDeployment := s.buildReplicaSetToDeploymentMap(ctx, namespace)

	// Build full details
	details := s.buildPodDetailInfo(*pod, podMetrics, rsToDeployment)

	// Add node IP
	if pod.Spec.NodeName != "" {
		details.NodeIP = s.getNodeIP(ctx, pod.Spec.NodeName)
	}

	// Add containers
	for i, container := range pod.Spec.Containers {
		details.Containers = append(details.Containers, buildContainerDetails(container, pod.Status.ContainerStatuses, i))
	}
	for i, container := range pod.Spec.InitContainers {
		details.InitContainers = append(details.InitContainers, buildContainerDetails(container, pod.Status.InitContainerStatuses, i))
	}

	// Add formatted fields
	details.Volumes = formatPodVolumes(pod.Spec.Volumes)
	details.Tolerations = FormatPodTolerations(pod.Spec.Tolerations)
	details.Affinity = buildAffinityMap(pod.Spec.Affinity)
	details.SecurityContext = buildSecurityContextMap(pod.Spec.SecurityContext)

	if pod.Spec.RuntimeClassName != nil {
		details.RuntimeClass = *pod.Spec.RuntimeClassName
	}

	return details, nil
}

// Helper functions for simplified pod handling

// buildReplicaSetToDeploymentMap builds a map of ReplicaSet names to Deployment names.
func (s *Service) buildReplicaSetToDeploymentMap(ctx context.Context, namespace string) map[string]string {
	rsToDeployment := make(map[string]string)

	rsList, err := s.deps.KubernetesClient.AppsV1().ReplicaSets(namespace).List(ctx, metav1.ListOptions{})
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

// getPodOwnerWithMap gets pod owner using pre-fetched ReplicaSet map.
// Returns (kind, name, apiVersion). When the controlling owner is a
// ReplicaSet that maps to a Deployment, the result is collapsed to the
// Deployment with apiVersion "apps/v1" (Deployments are always apps/v1).
// For all other owners apiVersion comes from owner.APIVersion verbatim,
// which is what lets the panel open CRD-as-Pod-owner targets like
// argoproj.io Rollout or kubevirt.io VirtualMachineInstance with a
// fully-qualified GVK.
func getPodOwnerWithMap(pod corev1.Pod, rsToDeployment map[string]string) (string, string, string) {
	for _, owner := range pod.OwnerReferences {
		if owner.Controller != nil && *owner.Controller {
			if owner.Kind == "ReplicaSet" {
				if deploymentName, ok := rsToDeployment[owner.Name]; ok {
					return "Deployment", deploymentName, "apps/v1"
				}
			}
			return owner.Kind, owner.Name, owner.APIVersion
		}
	}
	return "None", "None", ""
}

// getNodeIP retrieves the internal IP address for the given node, returning an empty
// string if the lookup fails.
func (s *Service) getNodeIP(ctx context.Context, nodeName string) string {
	if nodeName == "" {
		return ""
	}

	node, err := s.deps.KubernetesClient.CoreV1().Nodes().Get(ctx, nodeName, metav1.GetOptions{})
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
func (s *Service) buildPodDetailInfo(pod corev1.Pod, podMetrics map[string]*metricsv1beta1.PodMetrics, rsToDeployment map[string]string) *types.PodDetailInfo {
	// Calculate resources
	cpuRequest, cpuLimit, memRequest, memLimit := calculatePodResources(pod)

	// Get metrics
	cpuUsage, memUsage := getPodUsageFromMetrics(pod.Name, podMetrics)

	// Get owner
	ownerKind, ownerName, ownerAPIVersion := getPodOwnerWithMap(pod, rsToDeployment)

	model := BuildResourceModel(s.deps.ClusterID, &pod)
	podFacts := BuildFacts(&pod)

	return &types.PodDetailInfo{
		// Basic info
		Name:             pod.Name,
		Namespace:        pod.Namespace,
		StatusProjection: types.NewStatusProjection(model.Status),
		Ready:            formatPodFactsReady(podFacts),
		Restarts:         podFacts.RestartCount,
		CPURequest:       common.FormatCPU(cpuRequest),
		CPULimit:         common.FormatCPU(cpuLimit),
		CPUUsage:         common.FormatCPU(cpuUsage),
		MemRequest:       common.FormatMemory(memRequest),
		MemLimit:         common.FormatMemory(memLimit),
		MemUsage:         common.FormatMemory(memUsage),

		// Ownership
		OwnerKind:       ownerKind,
		OwnerName:       ownerName,
		OwnerAPIVersion: ownerAPIVersion,

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
		Conditions:     types.FormatConditions(podFacts.Conditions),
		Tolerations:    []string{},
	}
}

type podResourceTotals struct {
	cpuRequest    resource.Quantity
	cpuLimit      resource.Quantity
	memoryRequest resource.Quantity
	memoryLimit   resource.Quantity
}

func newPodResourceTotals() podResourceTotals {
	return podResourceTotals{
		cpuRequest:    *resource.NewQuantity(0, resource.DecimalSI),
		cpuLimit:      *resource.NewQuantity(0, resource.DecimalSI),
		memoryRequest: *resource.NewQuantity(0, resource.BinarySI),
		memoryLimit:   *resource.NewQuantity(0, resource.BinarySI),
	}
}

func (totals *podResourceTotals) add(requirements corev1.ResourceRequirements) {
	addResourceQuantity(&totals.cpuRequest, requirements.Requests, corev1.ResourceCPU)
	addResourceQuantity(&totals.cpuLimit, requirements.Limits, corev1.ResourceCPU)
	addResourceQuantity(&totals.memoryRequest, requirements.Requests, corev1.ResourceMemory)
	addResourceQuantity(&totals.memoryLimit, requirements.Limits, corev1.ResourceMemory)
}

func addResourceQuantity(total *resource.Quantity, resources corev1.ResourceList, name corev1.ResourceName) {
	if quantity, ok := resources[name]; ok {
		total.Add(quantity)
	}
}

func (totals *podResourceTotals) maximize(requirements corev1.ResourceRequirements) {
	maximizeResourceQuantity(&totals.cpuRequest, requirements.Requests, corev1.ResourceCPU)
	maximizeResourceQuantity(&totals.cpuLimit, requirements.Limits, corev1.ResourceCPU)
	maximizeResourceQuantity(&totals.memoryRequest, requirements.Requests, corev1.ResourceMemory)
	maximizeResourceQuantity(&totals.memoryLimit, requirements.Limits, corev1.ResourceMemory)
}

func maximizeResourceQuantity(current *resource.Quantity, resources corev1.ResourceList, name corev1.ResourceName) {
	quantity, ok := resources[name]
	if ok && quantity.Cmp(*current) > 0 {
		*current = quantity
	}
}

func (totals *podResourceTotals) maximizeWith(other podResourceTotals) {
	maximizeQuantity(&totals.cpuRequest, other.cpuRequest)
	maximizeQuantity(&totals.cpuLimit, other.cpuLimit)
	maximizeQuantity(&totals.memoryRequest, other.memoryRequest)
	maximizeQuantity(&totals.memoryLimit, other.memoryLimit)
}

func maximizeQuantity(current *resource.Quantity, candidate resource.Quantity) {
	if candidate.Cmp(*current) > 0 {
		*current = candidate
	}
}

func (totals *podResourceTotals) quantities() (*resource.Quantity, *resource.Quantity, *resource.Quantity, *resource.Quantity) {
	return &totals.cpuRequest, &totals.cpuLimit, &totals.memoryRequest, &totals.memoryLimit
}

// calculatePodResources sums regular-container resources, then takes the
// per-dimension maximum against the sequential init-container requirements.
func calculatePodResources(pod corev1.Pod) (*resource.Quantity, *resource.Quantity, *resource.Quantity, *resource.Quantity) {
	totals := newPodResourceTotals()
	for _, container := range pod.Spec.Containers {
		totals.add(container.Resources)
	}
	initMaximums := newPodResourceTotals()
	for _, container := range pod.Spec.InitContainers {
		initMaximums.maximize(container.Resources)
	}
	totals.maximizeWith(initMaximums)
	return totals.quantities()
}

// getPodMetrics fetches metrics from the metrics-server API
func (s *Service) getPodMetrics(ctx context.Context, namespace string) map[string]*metricsv1beta1.PodMetrics {
	metrics := make(map[string]*metricsv1beta1.PodMetrics)

	client := s.deps.MetricsClient
	if client == nil {
		config := s.deps.RestConfig
		if config != nil {
			metricsClient, err := metricsclient.NewForConfig(config)
			if err != nil {
				s.deps.Logger.Info(fmt.Sprintf("Metrics client not available: %v", err), logsources.ResourceLoader)
				return metrics
			}
			s.deps.SetMetricsClient(metricsClient)
			s.deps.MetricsClient = metricsClient
			client = metricsClient
		} else {
			return metrics
		}
	}

	// Fetch pod metrics
	podMetricsList, err := client.MetricsV1beta1().PodMetricses(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		s.deps.Logger.Info(fmt.Sprintf("Failed to fetch pod metrics for namespace %s: %v", namespace, err), logsources.ResourceLoader)
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
func (s *Service) getPodMetricsForPods(ctx context.Context, namespace string, pods []corev1.Pod) map[string]*metricsv1beta1.PodMetrics {
	metrics := make(map[string]*metricsv1beta1.PodMetrics)
	if len(pods) == 0 {
		return metrics
	}
	client := s.podMetricsClient()
	if client == nil {
		return metrics
	}
	if len(pods) <= 3 {
		return s.fetchIndividualPodMetrics(ctx, client, namespace, pods)
	}
	return s.fetchListedPodMetrics(ctx, client, namespace, pods)
}

func (s *Service) podMetricsClient() metricsclient.Interface {
	if s.deps.MetricsClient != nil {
		return s.deps.MetricsClient
	}
	if s.deps.RestConfig == nil {
		return nil
	}
	client, err := metricsclient.NewForConfig(s.deps.RestConfig)
	if err != nil {
		s.deps.Logger.Debug(fmt.Sprintf("Metrics client not available: %v", err), logsources.ResourceLoader)
		return nil
	}
	s.deps.SetMetricsClient(client)
	s.deps.MetricsClient = client
	return client
}

func (s *Service) fetchIndividualPodMetrics(ctx context.Context, client metricsclient.Interface, namespace string, pods []corev1.Pod) map[string]*metricsv1beta1.PodMetrics {
	metrics := make(map[string]*metricsv1beta1.PodMetrics)
	for _, pod := range pods {
		podMetric, err := client.MetricsV1beta1().PodMetricses(namespace).Get(ctx, pod.Name, metav1.GetOptions{})
		if err != nil {
			s.deps.Logger.Debug(fmt.Sprintf("No metrics for pod %s: %v", pod.Name, err), logsources.ResourceLoader)
			continue
		}
		metrics[pod.Name] = podMetric
	}
	return metrics
}

func (s *Service) fetchListedPodMetrics(ctx context.Context, client metricsclient.Interface, namespace string, pods []corev1.Pod) map[string]*metricsv1beta1.PodMetrics {
	metrics := make(map[string]*metricsv1beta1.PodMetrics)
	podMetricsList, err := client.MetricsV1beta1().PodMetricses(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		s.deps.Logger.Info(fmt.Sprintf("Failed to fetch pod metrics for namespace %s: %v", namespace, err), logsources.ResourceLoader)
		return metrics
	}
	podNames := make(map[string]struct{}, len(pods))
	for _, pod := range pods {
		podNames[pod.Name] = struct{}{}
	}
	for index := range podMetricsList.Items {
		pod := &podMetricsList.Items[index]
		if _, ok := podNames[pod.Name]; ok {
			metrics[pod.Name] = pod
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
	facts := BuildFacts(&pod)
	return formatPodFactsReady(facts)
}

func formatPodFactsReady(facts Facts) string {
	return fmt.Sprintf("%d/%d", facts.ReadyContainers, facts.TotalContainers)
}

// getPodRestartCount calculates the total restart count across all containers
func getPodRestartCount(pod corev1.Pod) int32 {
	facts := BuildFacts(&pod)
	return facts.RestartCount
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

// FormatPodTolerations formats pod tolerations for display
func FormatPodTolerations(tolerations []corev1.Toleration) []string {
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
func buildContainerDetails(container corev1.Container, statuses []corev1.ContainerStatus, index int) types.PodDetailInfoContainer {
	detail := types.PodDetailInfoContainer{
		Name:            container.Name,
		Image:           container.Image,
		ImagePullPolicy: string(container.ImagePullPolicy),
		Command:         container.Command,
		Args:            container.Args,
	}
	applyContainerResourceDetails(&detail, container.Resources)
	detail.Ports = formatContainerPorts(container.Ports)
	detail.VolumeMounts = formatContainerVolumeMounts(container.VolumeMounts)
	detail.Environment = formatContainerEnvironment(container.Env)
	applyContainerStatus(&detail, statuses, index)
	return detail
}

func applyContainerResourceDetails(detail *types.PodDetailInfoContainer, requirements corev1.ResourceRequirements) {
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

func formatContainerPorts(ports []corev1.ContainerPort) []string {
	var result []string
	for _, port := range ports {
		formatted := fmt.Sprintf("%d", port.ContainerPort)
		if port.Name != "" {
			formatted = fmt.Sprintf("%s (%s)", formatted, port.Name)
		}
		if port.Protocol != "" && port.Protocol != corev1.ProtocolTCP {
			formatted += fmt.Sprintf("/%s", port.Protocol)
		}
		result = append(result, formatted)
	}
	return result
}

func formatContainerVolumeMounts(mounts []corev1.VolumeMount) []string {
	var result []string
	for _, mount := range mounts {
		formatted := fmt.Sprintf("%s -> %s", mount.Name, mount.MountPath)
		if mount.ReadOnly {
			formatted += " (ro)"
		}
		if mount.SubPath != "" {
			formatted += fmt.Sprintf(" [%s]", mount.SubPath)
		}
		result = append(result, formatted)
	}
	return result
}

func formatContainerEnvironment(variables []corev1.EnvVar) map[string]string {
	if len(variables) == 0 {
		return nil
	}
	result := make(map[string]string)
	for _, variable := range variables {
		if value, ok := containerEnvironmentValue(variable); ok {
			result[variable.Name] = value
		}
	}
	return result
}

func containerEnvironmentValue(variable corev1.EnvVar) (string, bool) {
	if variable.Value != "" {
		return variable.Value, true
	}
	if variable.ValueFrom == nil {
		return "", false
	}
	switch {
	case variable.ValueFrom.ConfigMapKeyRef != nil:
		return fmt.Sprintf("configmap:%s/%s", variable.ValueFrom.ConfigMapKeyRef.Name, variable.ValueFrom.ConfigMapKeyRef.Key), true
	case variable.ValueFrom.SecretKeyRef != nil:
		return fmt.Sprintf("secret:%s/%s", variable.ValueFrom.SecretKeyRef.Name, variable.ValueFrom.SecretKeyRef.Key), true
	case variable.ValueFrom.FieldRef != nil:
		return fmt.Sprintf("field:%s", variable.ValueFrom.FieldRef.FieldPath), true
	default:
		return "", false
	}
}

func applyContainerStatus(detail *types.PodDetailInfoContainer, statuses []corev1.ContainerStatus, index int) {
	if index >= len(statuses) {
		return
	}
	status := statuses[index]
	detail.Ready = status.Ready
	detail.RestartCount = status.RestartCount
	applyContainerState(detail, status.State)
}

func applyContainerState(detail *types.PodDetailInfoContainer, state corev1.ContainerState) {
	switch {
	case state.Running != nil:
		detail.State = "running"
		if !state.Running.StartedAt.IsZero() {
			detail.StartedAt = common.FormatAge(state.Running.StartedAt.Time)
		}
	case state.Waiting != nil:
		detail.State = "waiting"
		detail.StateReason = state.Waiting.Reason
		detail.StateMessage = state.Waiting.Message
	case state.Terminated != nil:
		detail.State = "terminated"
		detail.StateReason = state.Terminated.Reason
		detail.StateMessage = state.Terminated.Message
	}
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

// GetPodMetricsForPods exposes selective pod metrics fetching for other packages.
func (s *Service) GetPodMetricsForPods(ctx context.Context, namespace string, pods []corev1.Pod) map[string]*metricsv1beta1.PodMetrics {
	return s.getPodMetricsForPods(ctx, namespace, pods)
}

// BuildReplicaSetToDeploymentMap exposes replica set ownership lookups.
func (s *Service) BuildReplicaSetToDeploymentMap(ctx context.Context, namespace string) map[string]string {
	return s.buildReplicaSetToDeploymentMap(ctx, namespace)
}

// SummarizePod converts a pod object and optional metrics into a PodSimpleInfo for list views.
func SummarizePod(clusterID string, pod corev1.Pod, metrics map[string]*metricsv1beta1.PodMetrics, ownerKind, ownerName, ownerAPIVersion string) types.PodSimpleInfo {
	cpuRequest, cpuLimit, memRequest, memLimit := CalculatePodResources(pod)
	cpuUsage, memUsage := PodUsageFromMetrics(pod.Name, metrics)
	model := BuildResourceModel(clusterID, &pod)
	podFacts := BuildFacts(&pod)

	return types.PodSimpleInfo{
		Kind:             "Pod",
		Name:             pod.Name,
		Namespace:        pod.Namespace,
		StatusProjection: types.NewStatusProjection(model.Status),
		Ready:            formatPodFactsReady(podFacts),
		Restarts:         podFacts.RestartCount,
		Age:              common.FormatAge(pod.CreationTimestamp.Time),
		CPURequest:       formatCPUQuantity(cpuRequest),
		CPULimit:         formatCPUQuantity(cpuLimit),
		CPUUsage:         formatCPUQuantity(cpuUsage),
		MemRequest:       formatMemoryQuantity(memRequest),
		MemLimit:         formatMemoryQuantity(memLimit),
		MemUsage:         formatMemoryQuantity(memUsage),
		OwnerKind:        ownerKind,
		OwnerName:        ownerName,
		OwnerAPIVersion:  ownerAPIVersion,
	}
}

// ResolveOwner determines the high-level owner for a pod, collapsing
// ReplicaSets into Deployments. Returns (kind, name, apiVersion). The
// apiVersion is "apps/v1" for the ReplicaSet→Deployment collapse and
// owner.APIVersion verbatim otherwise — required so the panel can open
// CRD-as-Pod-owner targets correctly.
func ResolveOwner(pod corev1.Pod, rsToDeployment map[string]string) (string, string, string) {
	for _, owner := range pod.OwnerReferences {
		if owner.Controller != nil && *owner.Controller {
			if owner.Kind == "ReplicaSet" {
				if deploymentName, ok := rsToDeployment[owner.Name]; ok {
					return "Deployment", deploymentName, "apps/v1"
				}
			}
			return owner.Kind, owner.Name, owner.APIVersion
		}
	}
	return "None", "None", ""
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
