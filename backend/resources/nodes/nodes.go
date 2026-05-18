/*
 * backend/resources/nodes/nodes.go
 *
 * Node resource handlers and maintenance operations.
 * - Supports cordon, uncordon, drain, and delete workflows.
 */

package nodes

import (
	"context"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/internal/parallel"
	"github.com/luxury-yacht/app/backend/nodemaintenance"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/luxury-yacht/app/backend/resources/common"
	restypes "github.com/luxury-yacht/app/backend/resources/types"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/fields"
	utilerrors "k8s.io/apimachinery/pkg/util/errors"
	kubectldrain "k8s.io/kubectl/pkg/drain"
	metricsclient "k8s.io/metrics/pkg/client/clientset/versioned"
)

type Service struct {
	deps common.Dependencies
}

const maxNodeDrainGracePeriodSeconds = 900

func NewService(deps common.Dependencies) *Service {
	return &Service{deps: deps}
}

func (s *Service) requestContext() context.Context {
	if s.deps.Context != nil {
		return s.deps.Context
	}
	return context.Background()
}

// Node returns detailed information about a single node.
func (s *Service) Node(name string) (*restypes.NodeDetails, error) {
	if err := s.ensureClient("Nodes"); err != nil {
		return nil, err
	}

	client := s.deps.KubernetesClient
	node, err := client.CoreV1().Nodes().Get(s.deps.Context, name, metav1.GetOptions{})
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

	client := s.deps.KubernetesClient
	nodeList, err := client.CoreV1().Nodes().List(s.deps.Context, metav1.ListOptions{})
	if err != nil {
		s.logError(fmt.Sprintf("Failed to list nodes: %v", err))
		return nil, fmt.Errorf("failed to list nodes: %v", err)
	}

	var (
		podsByNode  map[string][]corev1.Pod
		nodeMetrics map[string]corev1.ResourceList
	)

	if err := parallel.RunLimited(s.deps.Context, 0,
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
	return s.setUnschedulable(nodeName, true)
}

// Uncordon marks a node as schedulable.
func (s *Service) Uncordon(nodeName string) error {
	return s.setUnschedulable(nodeName, false)
}

func (s *Service) setUnschedulable(nodeName string, unschedulable bool) error {
	if err := s.ensureClient("Nodes"); err != nil {
		return err
	}

	ctx := s.requestContext()
	node, err := s.deps.KubernetesClient.CoreV1().Nodes().Get(ctx, nodeName, metav1.GetOptions{})
	if err != nil {
		return fmt.Errorf("failed to get node %s: %w", nodeName, err)
	}

	drainer := &kubectldrain.Helper{
		Ctx:    ctx,
		Client: s.deps.KubernetesClient,
		Out:    io.Discard,
		ErrOut: io.Discard,
	}
	err = kubectldrain.RunCordonOrUncordon(drainer, node, unschedulable)
	if err != nil {
		return fmt.Errorf("failed to patch node %s: %w", nodeName, err)
	}
	return nil
}

// Drain evicts or deletes pods on the node according to the provided options.
func (s *Service) Drain(nodeName string, options restypes.DrainNodeOptions) (err error) {
	if err := ValidateDrainOptions(options); err != nil {
		return err
	}
	store := nodemaintenance.GlobalStore()
	job, err := store.StartDrainForClusterIfIdle(nodeName, options, s.deps.ClusterID, s.deps.ClusterName)
	if err != nil {
		return err
	}

	return s.runDrainJob(job, nodeName, options)
}

// StartDrain starts a drain job in the background and returns immediately.
func (s *Service) StartDrain(nodeName string, options restypes.DrainNodeOptions) (*nodemaintenance.DrainJob, error) {
	return s.StartDrainWithCompletion(nodeName, options, nil)
}

// StartDrainWithCompletion starts a drain job and invokes onComplete after the job exits.
func (s *Service) StartDrainWithCompletion(nodeName string, options restypes.DrainNodeOptions, onComplete func(string)) (*nodemaintenance.DrainJob, error) {
	if err := ValidateDrainOptions(options); err != nil {
		return nil, err
	}
	store := nodemaintenance.GlobalStore()
	job, err := store.StartDrainForClusterIfIdle(nodeName, options, s.deps.ClusterID, s.deps.ClusterName)
	if err != nil {
		return nil, err
	}

	baseCtx := s.requestContext()
	ctx, cancel := context.WithCancel(baseCtx)
	store.RegisterCancel(job.ID, cancel)
	deps := s.deps.CloneWithContext(ctx)
	go func() {
		defer store.ClearCancel(job.ID)
		defer cancel()
		if onComplete != nil {
			defer onComplete(job.ID)
		}
		_ = NewService(deps).runDrainJob(job, nodeName, options)
	}()

	return job, nil
}

func (s *Service) runDrainJob(job *nodemaintenance.DrainJob, nodeName string, options restypes.DrainNodeOptions) (err error) {
	cordoned := false

	defer func() {
		s.finalizeDrain(job, cordoned, err)
	}()

	if err = s.cordonForDrain(job, nodeName); err != nil {
		return err
	}
	cordoned = true

	return s.runKubectlDrain(nodeName, options, job)
}

// finalizeDrain updates drain status when the drain operation finishes.
func (s *Service) finalizeDrain(job *nodemaintenance.DrainJob, cordoned bool, err error) {
	if job == nil {
		return
	}
	if err != nil {
		if errors.Is(err, context.Canceled) {
			job.Complete(nodemaintenance.DrainStatusCancelled, "Drain cancelled")
			return
		}
		if cordoned {
			job.AddInfo("cordon-retained", "Node remains cordoned after drain failure")
		}
		job.Complete(nodemaintenance.DrainStatusFailed, err.Error())
		return
	}
	job.Complete(nodemaintenance.DrainStatusSucceeded, "Drain completed successfully")
}

// cordonForDrain marks the node unschedulable and records drain events.
func (s *Service) cordonForDrain(job *nodemaintenance.DrainJob, nodeName string) error {
	job.AddInfo("cordon", "Cordoning node")
	if cordonErr := s.Cordon(nodeName); cordonErr != nil {
		job.AddInfo("error", fmt.Sprintf("Failed to cordon node: %v", cordonErr))
		return fmt.Errorf("failed to cordon node before draining: %w", cordonErr)
	}
	return nil
}

// ValidateDrainOptions rejects invalid drain options before starting node mutations.
func ValidateDrainOptions(options restypes.DrainNodeOptions) error {
	grace := options.GracePeriodSeconds
	if grace != nil {
		if *grace < 0 {
			return fmt.Errorf("gracePeriodSeconds must be non-negative")
		}
		if *grace > maxNodeDrainGracePeriodSeconds {
			return fmt.Errorf("gracePeriodSeconds must be less than or equal to %d", maxNodeDrainGracePeriodSeconds)
		}
	}
	if timeout := options.TimeoutSeconds; timeout != nil && *timeout < 0 {
		return fmt.Errorf("timeoutSeconds must be non-negative")
	}
	return nil
}

func drainHelperGracePeriod(options restypes.DrainNodeOptions) int {
	if options.GracePeriodSeconds == nil {
		return -1
	}
	return *options.GracePeriodSeconds
}

func drainHelperTimeout(options restypes.DrainNodeOptions) time.Duration {
	if options.TimeoutSeconds == nil || *options.TimeoutSeconds == 0 {
		return 0
	}
	return time.Duration(*options.TimeoutSeconds) * time.Second
}

func (s *Service) runKubectlDrain(nodeName string, options restypes.DrainNodeOptions, job *nodemaintenance.DrainJob) error {
	drainer := s.newDrainHelper(options, job)
	list, errs := drainer.GetPodsForDeletion(nodeName)
	if len(errs) > 0 {
		err := utilerrors.NewAggregate(errs)
		job.AddInfo("error", err.Error())
		return err
	}
	if warnings := list.Warnings(); warnings != "" {
		job.AddInfo("warning", warnings)
	}

	pods := list.Pods()
	job.AddInfo("plan", fmt.Sprintf("%s %d pods", drainOperationLabel(options), len(pods)))
	if options.SkipWaitForPodsToTerminate {
		job.AddInfo("skip-wait", "Submitting pod deletion or eviction without waiting for termination")
		return s.deleteOrEvictPodsWithoutWait(drainer, pods)
	}

	job.AddInfo("wait", "Waiting for pods to terminate")
	if err := drainer.DeleteOrEvictPods(pods); err != nil {
		if isDrainTimeoutError(err, drainer.Timeout) {
			err = fmt.Errorf("drain timed out after %s while waiting for pods to terminate: %w", drainer.Timeout, err)
		}
		job.AddInfo("error", err.Error())
		return err
	}
	job.AddInfo("wait-complete", "All pods drained")
	return nil
}

func (s *Service) newDrainHelper(options restypes.DrainNodeOptions, job *nodemaintenance.DrainJob) *kubectldrain.Helper {
	return &kubectldrain.Helper{
		Ctx:                  s.requestContext(),
		Client:               s.deps.KubernetesClient,
		Force:                options.Force,
		GracePeriodSeconds:   drainHelperGracePeriod(options),
		IgnoreAllDaemonSets:  options.IgnoreDaemonSets,
		Timeout:              drainHelperTimeout(options),
		DeleteEmptyDirData:   options.DeleteEmptyDirData,
		DisableEviction:      options.DisableEviction,
		EvictErrorRetryDelay: config.NodeDrainRetryDelay,
		Out:                  io.Discard,
		ErrOut:               io.Discard,
		OnPodDeletionOrEvictionStarted: func(pod *corev1.Pod, usingEviction bool) {
			job.AddPodEvent(drainPodStartedPhase(usingEviction), pod.Namespace, pod.Name, drainPodStartedMessage(usingEviction), false)
		},
		OnPodDeletionOrEvictionFinished: func(pod *corev1.Pod, usingEviction bool, err error) {
			if err != nil {
				job.AddPodEvent(drainPodErrorPhase(usingEviction), pod.Namespace, pod.Name, err.Error(), true)
				return
			}
			job.AddPodEvent(drainPodFinishedPhase(usingEviction), pod.Namespace, pod.Name, drainPodFinishedMessage(usingEviction), false)
		},
	}
}

func (s *Service) deleteOrEvictPodsWithoutWait(drainer *kubectldrain.Helper, pods []corev1.Pod) error {
	if len(pods) == 0 {
		return nil
	}

	usingEviction := false
	evictionGroupVersion := corev1.SchemeGroupVersion
	if !drainer.DisableEviction {
		discoveredGroupVersion, err := kubectldrain.CheckEvictionSupport(drainer.Client)
		if err != nil {
			return err
		}
		if !discoveredGroupVersion.Empty() {
			usingEviction = true
			evictionGroupVersion = discoveredGroupVersion
		}
	}

	for _, pod := range pods {
		if err := drainer.Ctx.Err(); err != nil {
			return err
		}
		if drainer.OnPodDeletionOrEvictionStarted != nil {
			activePod := pod
			drainer.OnPodDeletionOrEvictionStarted(&activePod, usingEviction)
		}

		var err error
		if usingEviction {
			err = drainer.EvictPod(pod, evictionGroupVersion)
		} else {
			err = drainer.DeletePod(pod)
		}
		if apierrors.IsNotFound(err) {
			err = nil
		}

		if drainer.OnPodDeletionOrEvictionFinished != nil {
			finishedPod := pod
			drainer.OnPodDeletionOrEvictionFinished(&finishedPod, usingEviction, err)
		}
		if err != nil {
			return fmt.Errorf("error when %s pod %s/%s: %w", drainOperationGerund(usingEviction), pod.Namespace, pod.Name, err)
		}
	}
	return nil
}

func isDrainTimeoutError(err error, timeout time.Duration) bool {
	if timeout <= 0 || err == nil {
		return false
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return true
	}
	message := err.Error()
	return strings.Contains(message, "global timeout reached") ||
		strings.Contains(message, "context deadline exceeded")
}

func drainOperationLabel(options restypes.DrainNodeOptions) string {
	if options.DisableEviction {
		return "Deleting"
	}
	return "Evicting"
}

func drainOperationGerund(usingEviction bool) string {
	if usingEviction {
		return "evicting"
	}
	return "deleting"
}

func drainPodStartedPhase(usingEviction bool) string {
	if usingEviction {
		return "evicting"
	}
	return "deleting"
}

func drainPodStartedMessage(usingEviction bool) string {
	if usingEviction {
		return "Evicting pod"
	}
	return "Deleting pod"
}

func drainPodFinishedPhase(usingEviction bool) string {
	if usingEviction {
		return "evicted"
	}
	return "deleted"
}

func drainPodFinishedMessage(usingEviction bool) string {
	if usingEviction {
		return "Pod evicted"
	}
	return "Pod deleted"
}

func drainPodErrorPhase(usingEviction bool) string {
	if usingEviction {
		return "evict-error"
	}
	return "delete-error"
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

	if err := s.deps.KubernetesClient.CoreV1().Nodes().Delete(s.deps.Context, nodeName, deleteOptions); err != nil {
		s.logError(fmt.Sprintf("Failed to delete node %s: %v", nodeName, err))
		return fmt.Errorf("failed to delete node: %v", err)
	}

	return nil
}

// nodePodFieldSelector returns the field selector for pods scheduled on a node.
func nodePodFieldSelector(nodeName string) string {
	return fields.OneTermEqualSelector("spec.nodeName", nodeName).String()
}

func (s *Service) buildNodeDetails(node *corev1.Node, pods []corev1.Pod, nodeMetrics corev1.ResourceList) *restypes.NodeDetails {
	var cpuRequests, cpuLimits, memRequests, memLimits int64
	var podsList []restypes.PodSimpleInfo
	var nodeRestarts int32
	model := resourcemodel.BuildNodeResourceModel(s.deps.ClusterID, node)
	nodeFacts := model.Facts.Node

	for _, pod := range pods {
		podModel := resourcemodel.BuildPodResourceModel(s.deps.ClusterID, &pod)
		podFacts := podModel.Facts.Pod
		podRestarts := podFacts.RestartCount
		nodeRestarts += podRestarts

		podsList = append(podsList, restypes.PodSimpleInfo{
			Kind:               "Pod",
			Name:               pod.Name,
			Namespace:          pod.Namespace,
			Status:             podModel.Status.Label,
			StatusState:        podModel.Status.State,
			StatusPresentation: podModel.Status.Presentation,
			StatusReason:       podModel.Status.Reason,
			Ready:              fmt.Sprintf("%d/%d", podFacts.ReadyContainers, podFacts.TotalContainers),
			Restarts:           podRestarts,
			Age:                common.FormatAge(pod.CreationTimestamp.Time),
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
		Name:               node.Name,
		Status:             model.Status.Label,
		StatusState:        model.Status.State,
		StatusPresentation: model.Status.Presentation,
		StatusReason:       model.Status.Reason,
		Age:                common.FormatAge(node.CreationTimestamp.Time),
		Unschedulable:      nodeFacts != nil && nodeFacts.Unschedulable,
		Architecture:       node.Status.NodeInfo.Architecture,
		OS:                 node.Status.NodeInfo.OperatingSystem,
		OSImage:            node.Status.NodeInfo.OSImage,
		KernelVersion:      node.Status.NodeInfo.KernelVersion,
		ContainerRuntime:   node.Status.NodeInfo.ContainerRuntimeVersion,
		KubeletVersion:     node.Status.NodeInfo.KubeletVersion,
		Labels:             node.Labels,
		Annotations:        node.Annotations,
		PodsList:           podsList,
		PodsCount:          len(podsList),
		Restarts:           nodeRestarts,
	}

	for _, condition := range node.Status.Conditions {
		details.Conditions = append(details.Conditions, restypes.NodeCondition{
			Kind:    string(condition.Type),
			Status:  string(condition.Status),
			Reason:  condition.Reason,
			Message: condition.Message,
		})
	}

	for _, taint := range node.Spec.Taints {
		details.Taints = append(details.Taints, restypes.NodeTaint{
			Key:    taint.Key,
			Value:  taint.Value,
			Effect: string(taint.Effect),
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
	client := s.deps.KubernetesClient
	if client == nil {
		return nil
	}

	ctx, cancel := context.WithTimeout(s.deps.Context, config.NamespaceOperationTimeout)
	defer cancel()

	podList, err := client.CoreV1().Pods("").List(ctx, metav1.ListOptions{
		FieldSelector: nodePodFieldSelector(name),
	})
	if err != nil {
		s.logInfo(fmt.Sprintf("Failed to list pods for node %s: %v", name, err))
		return nil
	}
	return podList.Items
}

func (s *Service) listAllPodsByNode() map[string][]corev1.Pod {
	client := s.deps.KubernetesClient
	result := make(map[string][]corev1.Pod)
	if client == nil {
		return result
	}

	ctx, cancel := context.WithTimeout(s.deps.Context, config.NamespaceOperationTimeout)
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
	if s.deps.MetricsClient == nil {
		return nil
	}

	metric, err := s.deps.MetricsClient.MetricsV1beta1().NodeMetricses().Get(s.deps.Context, name, metav1.GetOptions{})
	if err != nil {
		s.logInfo(fmt.Sprintf("Failed to fetch metrics for node %s: %v", name, err))
		return nil
	}
	return metric.Usage
}

func (s *Service) listNodeMetrics() map[string]corev1.ResourceList {
	s.ensureMetricsClient()
	if s.deps.MetricsClient == nil {
		return nil
	}

	metricsList, err := s.deps.MetricsClient.MetricsV1beta1().NodeMetricses().List(s.deps.Context, metav1.ListOptions{})
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
	if s.deps.MetricsClient != nil {
		return
	}
	if s.deps.RestConfig == nil || s.deps.SetMetricsClient == nil {
		return
	}

	metricsClient, err := metricsclient.NewForConfig(s.deps.RestConfig)
	if err != nil {
		s.logInfo(fmt.Sprintf("Metrics client not available: %v", err))
		return
	}

	s.deps.SetMetricsClient(metricsClient)
	s.deps.MetricsClient = metricsClient
}

func (s *Service) ensureClient(resource string) error {
	if s.deps.EnsureClient != nil {
		if err := s.deps.EnsureClient(resource); err != nil {
			return err
		}
	}
	if s.deps.KubernetesClient == nil {
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
	if s.deps.Logger != nil {
		s.deps.Logger.Info(msg, "NodeOperations")
	}
}

func (s *Service) logError(msg string) {
	if s.deps.Logger != nil {
		s.deps.Logger.Error(msg, "NodeOperations")
	}
}
