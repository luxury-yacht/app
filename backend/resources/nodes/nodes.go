package nodes

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/internal/parallel"
	"github.com/luxury-yacht/app/backend/nodemaintenance"
	"github.com/luxury-yacht/app/backend/resources/common"
	restypes "github.com/luxury-yacht/app/backend/resources/types"
	corev1 "k8s.io/api/core/v1"
	policyv1beta1 "k8s.io/api/policy/v1beta1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/fields"
	"k8s.io/apimachinery/pkg/types"
	metricsclient "k8s.io/metrics/pkg/client/clientset/versioned"
	"k8s.io/utils/ptr"
)

// Dependencies captures collaborators required for node operations.
type Dependencies struct {
	Common common.Dependencies
}

// Service exposes helpers for node inspection and management.
type Service struct {
	deps Dependencies
}

// NewService constructs a node service instance.
func NewService(deps Dependencies) *Service {
	return &Service{deps: deps}
}

// Node returns detailed information about a single node.
func (s *Service) Node(name string) (*restypes.NodeDetails, error) {
	if err := s.ensureClient("Nodes"); err != nil {
		return nil, err
	}

	client := s.deps.Common.KubernetesClient
	node, err := client.CoreV1().Nodes().Get(s.deps.Common.Context, name, metav1.GetOptions{})
	if err != nil {
		s.logError(fmt.Sprintf("Failed to get node %s: %v", name, err))
		return nil, fmt.Errorf("failed to get node: %v", err)
	}

	pods := s.listPodsForNode(name)
	nodeMetrics := s.getNodeMetrics(name)

	return s.buildNodeDetails(node, pods, nodeMetrics), nil
}

// Nodes returns detailed information about all nodes in the cluster.
func (s *Service) Nodes() ([]*restypes.NodeDetails, error) {
	if err := s.ensureClient("Nodes"); err != nil {
		return nil, err
	}

	client := s.deps.Common.KubernetesClient
	nodeList, err := client.CoreV1().Nodes().List(s.deps.Common.Context, metav1.ListOptions{})
	if err != nil {
		s.logError(fmt.Sprintf("Failed to list nodes: %v", err))
		return nil, fmt.Errorf("failed to list nodes: %v", err)
	}

	var (
		podsByNode  map[string][]corev1.Pod
		nodeMetrics map[string]corev1.ResourceList
	)

	if err := parallel.RunLimited(s.deps.Common.Context, 0,
		func(context.Context) error {
			podsByNode = s.listAllPodsByNode()
			return nil
		},
		func(context.Context) error {
			nodeMetrics = s.listNodeMetrics()
			return nil
		},
	); err != nil {
		return nil, err
	}

	details := make([]*restypes.NodeDetails, 0, len(nodeList.Items))
	for i := range nodeList.Items {
		node := &nodeList.Items[i]
		details = append(details, s.buildNodeDetails(node, podsByNode[node.Name], nodeMetrics[node.Name]))
	}

	return details, nil
}

// Cordon marks a node as unschedulable.
func (s *Service) Cordon(nodeName string) error {
	return s.patchUnschedulable(nodeName, true)
}

// Uncordon marks a node as schedulable.
func (s *Service) Uncordon(nodeName string) error {
	return s.patchUnschedulable(nodeName, false)
}

// Drain evicts or deletes pods on the node according to the provided options.
func (s *Service) Drain(nodeName string, options restypes.DrainNodeOptions) (err error) {
	job := nodemaintenance.GlobalStore().StartDrain(nodeName, options)
	cordoned := false

	defer func() {
		if job == nil {
			return
		}
		if err != nil {
			// Rollback: uncordon node if drain failed and we're not forcing
			if cordoned && !options.Force {
				job.AddInfo("rollback", "Uncordoning node due to drain failure")
				if uncordonErr := s.Uncordon(nodeName); uncordonErr != nil {
					s.logError(fmt.Sprintf("Failed to uncordon node %s during rollback: %v", nodeName, uncordonErr))
					job.AddInfo("rollback-error", fmt.Sprintf("Failed to uncordon: %v", uncordonErr))
				} else {
					s.logInfo(fmt.Sprintf("Rollback: uncordoned node %s after drain failure", nodeName))
					job.AddInfo("rollback-complete", "Node uncordoned")
				}
			}
			job.Complete(nodemaintenance.DrainStatusFailed, err.Error())
		} else {
			job.Complete(nodemaintenance.DrainStatusSucceeded, "Drain completed successfully")
		}
	}()

	job.AddInfo("cordon", "Cordoning node")
	if cordonErr := s.Cordon(nodeName); cordonErr != nil {
		job.AddInfo("error", fmt.Sprintf("Failed to cordon node: %v", cordonErr))
		err = fmt.Errorf("failed to cordon node before draining: %w", cordonErr)
		return
	}
	cordoned = true

	client := s.deps.Common.KubernetesClient

	// Use timeout context for pod listing
	listCtx, listCancel := context.WithTimeout(s.deps.Common.Context, config.NodeDrainTimeout)
	defer listCancel()

	podList, err := client.CoreV1().Pods("").List(listCtx, metav1.ListOptions{
		FieldSelector: fields.OneTermEqualSelector("spec.nodeName", nodeName).String(),
	})
	if err != nil {
		job.AddInfo("error", fmt.Sprintf("Failed to list pods: %v", err))
		err = fmt.Errorf("failed to list pods on node: %w", err)
		return
	}

	podsToEvict, err := s.filterPodsForDrain(podList.Items, options)
	if err != nil {
		job.AddInfo("error", err.Error())
		return
	}
	job.AddInfo("plan", fmt.Sprintf("Evicting %d pods", len(podsToEvict)))

	// Per-pod operation timeout (30 seconds per pod)
	podOpTimeout := 30 * time.Second

	for _, pod := range podsToEvict {
		job.AddPodEvent("evicting", pod.Namespace, pod.Name, "Evicting pod", false)
		success := true

		// Create timeout context for this pod operation
		podCtx, podCancel := context.WithTimeout(s.deps.Common.Context, podOpTimeout)

		if options.DisableEviction {
			grace := int64(options.GracePeriodSeconds)
			deleteOptions := metav1.DeleteOptions{GracePeriodSeconds: &grace}
			if delErr := client.CoreV1().Pods(pod.Namespace).Delete(podCtx, pod.Name, deleteOptions); delErr != nil {
				s.logError(fmt.Sprintf("Failed to delete pod %s/%s: %v", pod.Namespace, pod.Name, delErr))
				job.AddPodEvent("delete-error", pod.Namespace, pod.Name, delErr.Error(), true)
				if !options.Force {
					podCancel()
					err = fmt.Errorf("failed to delete pod %s/%s: %v", pod.Namespace, pod.Name, delErr)
					return
				}
				success = false
			}
		} else {
			eviction := &policyv1beta1.Eviction{
				ObjectMeta: metav1.ObjectMeta{Namespace: pod.Namespace, Name: pod.Name},
				DeleteOptions: &metav1.DeleteOptions{
					GracePeriodSeconds: ptr.To(int64(options.GracePeriodSeconds)),
				},
			}
			if evictErr := client.CoreV1().Pods(pod.Namespace).Evict(podCtx, eviction); evictErr != nil {
				s.logError(fmt.Sprintf("Failed to evict pod %s/%s: %v", pod.Namespace, pod.Name, evictErr))
				job.AddPodEvent("evict-error", pod.Namespace, pod.Name, evictErr.Error(), true)
				if !options.Force {
					podCancel()
					err = fmt.Errorf("failed to evict pod %s/%s: %v", pod.Namespace, pod.Name, evictErr)
					return
				}
				success = false
			}
		}

		podCancel()

		if success {
			job.AddPodEvent("evicted", pod.Namespace, pod.Name, "Pod evicted", false)
		}
	}

	if !options.SkipWaitForPodsToTerminate {
		job.AddInfo("wait", "Waiting for pods to terminate")
		if err := s.waitForPodsToTerminate(nodeName, options); err != nil && !options.Force {
			job.AddInfo("error", err.Error())
			return err
		} else if err != nil && options.Force {
			job.AddInfo("warning", fmt.Sprintf("Wait for pods completed with errors: %v", err))
		} else {
			job.AddInfo("wait-complete", "All pods drained")
		}
	} else {
		job.AddInfo("skip-wait", "Skipped wait for pod termination")
	}

	return nil
}

// Delete removes a node from the cluster.
func (s *Service) Delete(nodeName string, force bool) error {
	if err := s.ensureClient("Nodes"); err != nil {
		return err
	}

	deleteOptions := metav1.DeleteOptions{}
	if force {
		zero := int64(0)
		deleteOptions.GracePeriodSeconds = &zero
	}

	if err := s.deps.Common.KubernetesClient.CoreV1().Nodes().Delete(s.deps.Common.Context, nodeName, deleteOptions); err != nil {
		s.logError(fmt.Sprintf("Failed to delete node %s: %v", nodeName, err))
		return fmt.Errorf("failed to delete node: %v", err)
	}

	return nil
}

func (s *Service) patchUnschedulable(nodeName string, unschedulable bool) error {
	if err := s.ensureClient("Nodes"); err != nil {
		return err
	}

	patch := []byte(fmt.Sprintf(`{"spec":{"unschedulable":%t}}`, unschedulable))
	_, err := s.deps.Common.KubernetesClient.CoreV1().Nodes().Patch(
		s.deps.Common.Context,
		nodeName,
		types.StrategicMergePatchType,
		patch,
		metav1.PatchOptions{},
	)
	if err != nil {
		return fmt.Errorf("failed to patch node %s: %w", nodeName, err)
	}
	return nil
}

func (s *Service) filterPodsForDrain(pods []corev1.Pod, options restypes.DrainNodeOptions) ([]corev1.Pod, error) {
	var result []corev1.Pod
	for _, pod := range pods {
		if _, ok := pod.Annotations[corev1.MirrorPodAnnotationKey]; ok {
			continue
		}
		if options.IgnoreDaemonSets && isDaemonSetPod(&pod) {
			continue
		}
		if !options.DeleteEmptyDirData && hasLocalStorage(&pod) {
			s.logInfo(fmt.Sprintf("Pod %s/%s has local storage", pod.Namespace, pod.Name))
			if !options.Force {
				return nil, fmt.Errorf("pod %s/%s has local storage; set deleteEmptyDirData to true or use force", pod.Namespace, pod.Name)
			}
		}
		result = append(result, pod)
	}
	return result, nil
}

func (s *Service) waitForPodsToTerminate(nodeName string, options restypes.DrainNodeOptions) error {
	client := s.deps.Common.KubernetesClient
	timeout := time.Duration(options.GracePeriodSeconds) * time.Second
	if timeout == 0 {
		timeout = config.NodeDrainTimeout
	}

	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		// Use timeout context for each poll iteration
		pollCtx, pollCancel := context.WithTimeout(s.deps.Common.Context, 10*time.Second)
		remaining, err := client.CoreV1().Pods("").List(pollCtx, metav1.ListOptions{
			FieldSelector: fields.OneTermEqualSelector("spec.nodeName", nodeName).String(),
		})
		pollCancel()

		if err != nil {
			s.logInfo(fmt.Sprintf("Failed to check remaining pods on node %s: %v", nodeName, err))
			break
		}

		hasPods := false
		for _, pod := range remaining.Items {
			if _, ok := pod.Annotations[corev1.MirrorPodAnnotationKey]; ok {
				continue
			}
			if options.IgnoreDaemonSets && isDaemonSetPod(&pod) {
				continue
			}
			hasPods = true
			break
		}

		if !hasPods {
			return nil
		}

		time.Sleep(config.NodeDrainRetryDelay)
	}

	return fmt.Errorf("timed out waiting for pods to terminate on node %s", nodeName)
}

func (s *Service) buildNodeDetails(node *corev1.Node, pods []corev1.Pod, nodeMetrics corev1.ResourceList) *restypes.NodeDetails {
	var cpuRequests, cpuLimits, memRequests, memLimits int64
	var podsList []restypes.PodSimpleInfo
	var nodeRestarts int32

	for _, pod := range pods {
		var podRestarts int32
		for _, cs := range pod.Status.ContainerStatuses {
			podRestarts += cs.RestartCount
		}
		nodeRestarts += podRestarts

		podsList = append(podsList, restypes.PodSimpleInfo{
			Name:      pod.Name,
			Namespace: pod.Namespace,
			Status:    string(pod.Status.Phase),
			Restarts:  podRestarts,
			Age:       common.FormatAge(pod.CreationTimestamp.Time),
		})

		if pod.Status.Phase == corev1.PodRunning || pod.Status.Phase == corev1.PodPending {
			for _, container := range pod.Spec.Containers {
				if req := container.Resources.Requests; req != nil {
					if cpu, ok := req[corev1.ResourceCPU]; ok {
						cpuRequests += cpu.MilliValue()
					}
					if mem, ok := req[corev1.ResourceMemory]; ok {
						memRequests += mem.Value()
					}
				}
				if lim := container.Resources.Limits; lim != nil {
					if cpu, ok := lim[corev1.ResourceCPU]; ok {
						cpuLimits += cpu.MilliValue()
					}
					if mem, ok := lim[corev1.ResourceMemory]; ok {
						memLimits += mem.Value()
					}
				}
			}
		}
	}

	details := &restypes.NodeDetails{
		Name:             node.Name,
		Age:              common.FormatAge(node.CreationTimestamp.Time),
		Unschedulable:    node.Spec.Unschedulable,
		Architecture:     node.Status.NodeInfo.Architecture,
		OS:               node.Status.NodeInfo.OperatingSystem,
		OSImage:          node.Status.NodeInfo.OSImage,
		KernelVersion:    node.Status.NodeInfo.KernelVersion,
		ContainerRuntime: node.Status.NodeInfo.ContainerRuntimeVersion,
		KubeletVersion:   node.Status.NodeInfo.KubeletVersion,
		Version:          node.Status.NodeInfo.KubeletVersion,
		Labels:           node.Labels,
		Annotations:      node.Annotations,
		PodsList:         podsList,
		PodsCount:        len(podsList),
		Restarts:         nodeRestarts,
	}

	for _, condition := range node.Status.Conditions {
		if condition.Type == corev1.NodeReady {
			if condition.Status == corev1.ConditionTrue {
				details.Status = "Ready"
			} else {
				details.Status = "NotReady"
			}
		}
		details.Conditions = append(details.Conditions, restypes.NodeCondition{
			Kind:    string(condition.Type),
			Status:  string(condition.Status),
			Reason:  condition.Reason,
			Message: condition.Message,
		})
	}

	details.Roles = deriveNodeRoles(node.Labels)
	setNodeAddresses(details, node.Status.Addresses)
	setNodeCapacity(details, node.Status.Capacity, node.Status.Allocatable)
	setNodeRequests(details, cpuRequests, cpuLimits, memRequests, memLimits)
	setNodeUsage(details, nodeMetrics)
	details.Kind = "node"
	setLegacySummaries(details)

	return details
}

func (s *Service) listPodsForNode(name string) []corev1.Pod {
	client := s.deps.Common.KubernetesClient
	if client == nil {
		return nil
	}

	ctx, cancel := context.WithTimeout(s.deps.Common.Context, config.NamespaceOperationTimeout)
	defer cancel()

	podList, err := client.CoreV1().Pods("").List(ctx, metav1.ListOptions{
		FieldSelector: fields.OneTermEqualSelector("spec.nodeName", name).String(),
	})
	if err != nil {
		s.logInfo(fmt.Sprintf("Failed to list pods for node %s: %v", name, err))
		return nil
	}
	return podList.Items
}

func (s *Service) listAllPodsByNode() map[string][]corev1.Pod {
	client := s.deps.Common.KubernetesClient
	result := make(map[string][]corev1.Pod)
	if client == nil {
		return result
	}

	ctx, cancel := context.WithTimeout(s.deps.Common.Context, config.NamespaceOperationTimeout)
	defer cancel()

	podList, err := client.CoreV1().Pods("").List(ctx, metav1.ListOptions{})
	if err != nil {
		s.logInfo(fmt.Sprintf("Failed to list cluster pods: %v", err))
		return result
	}

	for _, pod := range podList.Items {
		if pod.Spec.NodeName == "" {
			continue
		}
		result[pod.Spec.NodeName] = append(result[pod.Spec.NodeName], pod)
	}

	return result
}

func (s *Service) getNodeMetrics(name string) corev1.ResourceList {
	s.ensureMetricsClient()
	if s.deps.Common.MetricsClient == nil {
		return nil
	}

	metric, err := s.deps.Common.MetricsClient.MetricsV1beta1().NodeMetricses().Get(s.deps.Common.Context, name, metav1.GetOptions{})
	if err != nil {
		s.logInfo(fmt.Sprintf("Failed to fetch metrics for node %s: %v", name, err))
		return nil
	}
	return metric.Usage
}

func (s *Service) listNodeMetrics() map[string]corev1.ResourceList {
	s.ensureMetricsClient()
	if s.deps.Common.MetricsClient == nil {
		return nil
	}

	metricsList, err := s.deps.Common.MetricsClient.MetricsV1beta1().NodeMetricses().List(s.deps.Common.Context, metav1.ListOptions{})
	if err != nil {
		s.logInfo(fmt.Sprintf("Failed to list node metrics: %v", err))
		return nil
	}

	result := make(map[string]corev1.ResourceList)
	for i := range metricsList.Items {
		metric := &metricsList.Items[i]
		result[metric.Name] = metric.Usage
	}
	return result
}

func (s *Service) ensureMetricsClient() {
	if s.deps.Common.MetricsClient != nil {
		return
	}
	if s.deps.Common.RestConfig == nil || s.deps.Common.SetMetricsClient == nil {
		return
	}

	metricsClient, err := metricsclient.NewForConfig(s.deps.Common.RestConfig)
	if err != nil {
		s.logInfo(fmt.Sprintf("Metrics client not available: %v", err))
		return
	}

	s.deps.Common.SetMetricsClient(metricsClient)
	s.deps.Common.MetricsClient = metricsClient
}

func (s *Service) ensureClient(resource string) error {
	if s.deps.Common.EnsureClient != nil {
		if err := s.deps.Common.EnsureClient(resource); err != nil {
			return err
		}
	}
	if s.deps.Common.KubernetesClient == nil {
		return fmt.Errorf("kubernetes client not initialized")
	}
	return nil
}

func deriveNodeRoles(labels map[string]string) string {
	if labels == nil {
		return "worker"
	}

	var roles []string
	if _, ok := labels["node-role.kubernetes.io/control-plane"]; ok {
		roles = append(roles, "control-plane")
	} else if _, ok := labels["node-role.kubernetes.io/master"]; ok {
		roles = append(roles, "master")
	}
	if _, ok := labels["node-role.kubernetes.io/worker"]; ok {
		roles = append(roles, "worker")
	}
	for label := range labels {
		if role, ok := strings.CutPrefix(label, "node-role.kubernetes.io/"); ok {
			if role != "control-plane" && role != "master" && role != "worker" {
				roles = append(roles, role)
			}
		}
	}
	if len(roles) == 0 {
		return "worker"
	}
	return strings.Join(roles, ",")
}

func setNodeAddresses(details *restypes.NodeDetails, addresses []corev1.NodeAddress) {
	for _, addr := range addresses {
		switch addr.Type {
		case corev1.NodeInternalIP:
			details.InternalIP = addr.Address
		case corev1.NodeExternalIP:
			details.ExternalIP = addr.Address
		case corev1.NodeHostName:
			details.Hostname = addr.Address
		}
	}
}

func setNodeCapacity(details *restypes.NodeDetails, capacity, allocatable corev1.ResourceList) {
	if cpu, ok := capacity[corev1.ResourceCPU]; ok {
		details.CPUCapacity = cpu.String()
	}
	if cpu, ok := allocatable[corev1.ResourceCPU]; ok {
		details.CPUAllocatable = cpu.String()
	}
	if mem, ok := capacity[corev1.ResourceMemory]; ok {
		details.MemoryCapacity = formatMemoryBytes(mem.Value())
	}
	if mem, ok := allocatable[corev1.ResourceMemory]; ok {
		details.MemoryAllocatable = formatMemoryBytes(mem.Value())
	}
	if pods, ok := capacity[corev1.ResourcePods]; ok {
		details.PodsCapacity = pods.String()
	}
	if pods, ok := allocatable[corev1.ResourcePods]; ok {
		details.PodsAllocatable = pods.String()
	}
	if storage, ok := capacity[corev1.ResourceEphemeralStorage]; ok {
		details.StorageCapacity = formatMemoryBytes(storage.Value())
	}
}

func setNodeRequests(details *restypes.NodeDetails, cpuRequests, cpuLimits, memRequests, memLimits int64) {
	if cpuRequests > 0 {
		details.CPURequests = fmt.Sprintf("%dm", cpuRequests)
	} else {
		details.CPURequests = "0m"
	}
	if cpuLimits > 0 {
		details.CPULimits = fmt.Sprintf("%dm", cpuLimits)
	} else {
		details.CPULimits = "0m"
	}
	if memRequests > 0 {
		details.MemRequests = formatMemoryBytes(memRequests)
	} else {
		details.MemRequests = "0Mi"
	}
	if memLimits > 0 {
		details.MemLimits = formatMemoryBytes(memLimits)
	} else {
		details.MemLimits = "0Mi"
	}
}

func setNodeUsage(details *restypes.NodeDetails, usage corev1.ResourceList) {
	if usage == nil {
		return
	}
	if cpu, ok := usage[corev1.ResourceCPU]; ok {
		details.CPUUsage = fmt.Sprintf("%dm", cpu.MilliValue())
	}
	if mem, ok := usage[corev1.ResourceMemory]; ok {
		details.MemoryUsage = formatMemoryBytes(mem.Value())
	}
}

func setLegacySummaries(details *restypes.NodeDetails) {
	if details.CPUCapacity != "" {
		details.CPU = details.CPUCapacity
	}
	if details.MemoryCapacity != "" {
		details.Memory = details.MemoryCapacity
	}
	details.Pods = fmt.Sprintf("%d/%s", details.PodsCount, details.PodsCapacity)
}

func formatMemoryBytes(bytes int64) string {
	gb := float64(bytes) / (1024 * 1024 * 1024)
	if gb >= 1 {
		return fmt.Sprintf("%.1f GB", gb)
	}
	mb := float64(bytes) / (1024 * 1024)
	if mb >= 1 {
		return fmt.Sprintf("%.0f MB", mb)
	}
	kb := float64(bytes) / 1024
	return fmt.Sprintf("%.0f KB", kb)
}

func (s *Service) logInfo(msg string) {
	if s.deps.Common.Logger != nil {
		s.deps.Common.Logger.Info(msg, "NodeOperations")
	}
}

func (s *Service) logError(msg string) {
	if s.deps.Common.Logger != nil {
		s.deps.Common.Logger.Error(msg, "NodeOperations")
	}
}

func isDaemonSetPod(pod *corev1.Pod) bool {
	for _, owner := range pod.OwnerReferences {
		if owner.Kind == "DaemonSet" {
			return true
		}
	}
	return false
}

func hasLocalStorage(pod *corev1.Pod) bool {
	for _, volume := range pod.Spec.Volumes {
		if volume.EmptyDir != nil || volume.HostPath != nil {
			return true
		}
	}
	return false
}
