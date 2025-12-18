package snapshot

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"

	appsv1 "k8s.io/api/apps/v1"
	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/labels"
	informers "k8s.io/client-go/informers"
	appslisters "k8s.io/client-go/listers/apps/v1"
	batchlisters "k8s.io/client-go/listers/batch/v1"
	corelisters "k8s.io/client-go/listers/core/v1"

	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
	"github.com/luxury-yacht/app/backend/refresh/logstream"
	"github.com/luxury-yacht/app/backend/refresh/metrics"
)

const (
	namespaceWorkloadsDomainName = "namespace-workloads"
	namespaceWorkloadsEntryLimit = 1000
	errNamespaceScopeRequired    = "namespace scope is required"
)

// NamespaceWorkloadsBuilder constructs namespace-scoped workload snapshots.
type NamespaceWorkloadsBuilder struct {
	podLister        corelisters.PodLister
	deploymentLister appslisters.DeploymentLister
	statefulLister   appslisters.StatefulSetLister
	daemonLister     appslisters.DaemonSetLister
	jobLister        batchlisters.JobLister
	cronJobLister    batchlisters.CronJobLister
	metrics          metrics.Provider
	logger           logstream.Logger
}

// NamespaceWorkloadsSnapshot is returned to the frontend.
type NamespaceWorkloadsSnapshot struct {
	Workloads []WorkloadSummary `json:"workloads"`
}

// WorkloadSummary mirrors the data required by the workloads table.
type WorkloadSummary struct {
	Kind       string `json:"kind"`
	Name       string `json:"name"`
	Namespace  string `json:"namespace"`
	Ready      string `json:"ready"`
	Status     string `json:"status"`
	Restarts   int32  `json:"restarts"`
	Age        string `json:"age"`
	CPUUsage   string `json:"cpuUsage,omitempty"`
	CPURequest string `json:"cpuRequest,omitempty"`
	CPULimit   string `json:"cpuLimit,omitempty"`
	MemUsage   string `json:"memUsage,omitempty"`
	MemRequest string `json:"memRequest,omitempty"`
	MemLimit   string `json:"memLimit,omitempty"`
}

func parseNamespaceScope(scope string) (string, error) {
	namespace := strings.TrimSpace(scope)
	if strings.HasPrefix(namespace, "namespace:") {
		namespace = strings.TrimPrefix(namespace, "namespace:")
		namespace = strings.TrimLeft(namespace, ":")
	}
	namespace = strings.TrimSpace(namespace)
	if namespace == "" {
		return "", errors.New(errNamespaceScopeRequired)
	}
	return namespace, nil
}

// RegisterNamespaceWorkloadsDomain wires the workloads domain into the registry.
func RegisterNamespaceWorkloadsDomain(
	reg *domain.Registry,
	factory informers.SharedInformerFactory,
	provider metrics.Provider,
	logger logstream.Logger,
) error {
	if factory == nil {
		return fmt.Errorf("shared informer factory is nil")
	}
	builder := &NamespaceWorkloadsBuilder{
		podLister:        factory.Core().V1().Pods().Lister(),
		deploymentLister: factory.Apps().V1().Deployments().Lister(),
		statefulLister:   factory.Apps().V1().StatefulSets().Lister(),
		daemonLister:     factory.Apps().V1().DaemonSets().Lister(),
		jobLister:        factory.Batch().V1().Jobs().Lister(),
		cronJobLister:    factory.Batch().V1().CronJobs().Lister(),
		metrics:          provider,
		logger:           logger,
	}
	return reg.Register(refresh.DomainConfig{
		Name:          namespaceWorkloadsDomainName,
		BuildSnapshot: builder.Build,
	})
}

// Build assembles workload summaries for the requested namespace scope.
func (b *NamespaceWorkloadsBuilder) Build(ctx context.Context, scope string) (*refresh.Snapshot, error) {
	trimmed := strings.TrimSpace(scope)
	if trimmed == "" {
		return nil, errors.New(errNamespaceScopeRequired)
	}

	isAll := isAllNamespaceScope(trimmed)
	var (
		namespace  string
		scopeLabel string
		err        error
	)
	if isAll {
		scopeLabel = "namespace:all"
	} else {
		namespace, err = parseNamespaceScope(trimmed)
		if err != nil {
			return nil, err
		}
		scopeLabel = trimmed
	}

	pods, err := b.listPods(namespace)
	if err != nil {
		return nil, fmt.Errorf("namespace workloads: failed to list pods: %w", err)
	}
	deployments, err := b.listDeployments(namespace)
	if err != nil {
		return nil, fmt.Errorf("namespace workloads: failed to list deployments: %w", err)
	}
	statefulSets, err := b.listStatefulSets(namespace)
	if err != nil {
		return nil, fmt.Errorf("namespace workloads: failed to list statefulsets: %w", err)
	}
	daemonSets, err := b.listDaemonSets(namespace)
	if err != nil {
		return nil, fmt.Errorf("namespace workloads: failed to list daemonsets: %w", err)
	}
	jobs, err := b.listJobs(namespace)
	if err != nil {
		return nil, fmt.Errorf("namespace workloads: failed to list jobs: %w", err)
	}
	cronJobs, err := b.listCronJobs(namespace)
	if err != nil {
		return nil, fmt.Errorf("namespace workloads: failed to list cronjobs: %w", err)
	}

	return b.buildSnapshot(scopeLabel, pods, deployments, statefulSets, daemonSets, jobs, cronJobs)
}
func (b *NamespaceWorkloadsBuilder) buildSnapshot(
	scope string,
	pods []*corev1.Pod,
	deployments []*appsv1.Deployment,
	statefulSets []*appsv1.StatefulSet,
	daemonSets []*appsv1.DaemonSet,
	jobs []*batchv1.Job,
	cronJobs []*batchv1.CronJob,
) (*refresh.Snapshot, error) {
	podUsage := map[string]metrics.PodUsage{}
	if b.metrics != nil {
		podUsage = b.metrics.LatestPodUsage()
	}

	podsByOwner := make(map[string][]*corev1.Pod)
	for _, pod := range pods {
		if pod == nil {
			continue
		}
		if ownerKey := ownerKeyForPod(pod); ownerKey != "" {
			podsByOwner[ownerKey] = append(podsByOwner[ownerKey], pod)
		}
	}

	var (
		items   []WorkloadSummary
		version uint64
	)

	appendSummary := func(summary WorkloadSummary, obj metav1.Object) {
		items = append(items, summary)
		if obj == nil {
			return
		}
		if v := resourceVersionOrTimestamp(obj); v > version {
			version = v
		}
	}

	for _, deployment := range deployments {
		if deployment == nil {
			continue
		}
		summary := b.buildDeploymentSummary(deployment, podsByOwner, podUsage)
		appendSummary(summary, deployment)
	}

	for _, stateful := range statefulSets {
		if stateful == nil {
			continue
		}
		summary := b.buildStatefulSetSummary(stateful, podsByOwner, podUsage)
		appendSummary(summary, stateful)
	}

	for _, daemon := range daemonSets {
		if daemon == nil {
			continue
		}
		summary := b.buildDaemonSetSummary(daemon, podsByOwner, podUsage)
		appendSummary(summary, daemon)
	}

	for _, job := range jobs {
		if job == nil {
			continue
		}
		summary := b.buildJobSummary(job, podsByOwner, podUsage)
		appendSummary(summary, job)
	}

	for _, cron := range cronJobs {
		if cron == nil {
			continue
		}
		summary := b.buildCronJobSummary(cron, podsByOwner, podUsage)
		appendSummary(summary, cron)
	}

	processedOwners := make(map[string]struct{}, len(items))
	for _, summary := range items {
		key := workloadOwnerKey(summary.Kind, summary.Namespace, summary.Name)
		processedOwners[key] = struct{}{}
	}

	for _, pod := range pods {
		if pod == nil {
			continue
		}
		if pod.Status.Phase == corev1.PodSucceeded || pod.Status.Phase == corev1.PodFailed {
			continue
		}
		if ownerKey := ownerKeyForPod(pod); ownerKey != "" {
			if _, ok := processedOwners[ownerKey]; ok {
				continue
			}
		}
		summary := buildStandalonePodSummary(pod, podUsage)
		appendSummary(summary, pod)
	}

	sortWorkloadSummaries(items)

	if len(items) > namespaceWorkloadsEntryLimit {
		items = items[:namespaceWorkloadsEntryLimit]
	}

	return &refresh.Snapshot{
		Domain:  namespaceWorkloadsDomainName,
		Scope:   scope,
		Version: version,
		Payload: NamespaceWorkloadsSnapshot{Workloads: items},
		Stats: refresh.SnapshotStats{
			ItemCount: len(items),
		},
	}, nil
}

func sortWorkloadSummaries(items []WorkloadSummary) {
	sort.SliceStable(items, func(i, j int) bool {
		if items[i].Kind != items[j].Kind {
			return items[i].Kind < items[j].Kind
		}
		if items[i].Name != items[j].Name {
			return items[i].Name < items[j].Name
		}
		if items[i].Namespace != items[j].Namespace {
			return items[i].Namespace < items[j].Namespace
		}
		return items[i].Status < items[j].Status
	})
}

func (b *NamespaceWorkloadsBuilder) buildDeploymentSummary(
	deployment *appsv1.Deployment,
	podsByOwner map[string][]*corev1.Pod,
	usage map[string]metrics.PodUsage,
) WorkloadSummary {
	var pods []*corev1.Pod
	if deployment != nil {
		key := workloadOwnerKey("Deployment", deployment.Namespace, deployment.Name)
		pods = podsByOwner[key]
	}
	resources := aggregateWorkloadPodResources(pods, usage)
	desired := int32(0)
	if deployment != nil && deployment.Spec.Replicas != nil {
		desired = *deployment.Spec.Replicas
	}
	ready := int32(0)
	if deployment != nil {
		ready = deployment.Status.ReadyReplicas
	}

	return WorkloadSummary{
		Kind:       "Deployment",
		Name:       deployment.Name,
		Namespace:  deployment.Namespace,
		Ready:      fmt.Sprintf("%d/%d", ready, desired),
		Status:     getDeploymentStatus(deployment),
		Restarts:   resources.Restarts,
		Age:        formatAge(deployment.CreationTimestamp.Time),
		CPUUsage:   formatWorkloadCPUMilli(resources.CPUUsageMilli),
		CPURequest: formatWorkloadCPUMilli(resources.CPURequestMilli),
		CPULimit:   formatWorkloadCPUMilli(resources.CPULimitMilli),
		MemUsage:   formatWorkloadMemory(resources.MemoryUsageBytes),
		MemRequest: formatWorkloadMemory(resources.MemoryRequestBytes),
		MemLimit:   formatWorkloadMemory(resources.MemoryLimitBytes),
	}
}

func (b *NamespaceWorkloadsBuilder) buildStatefulSetSummary(
	stateful *appsv1.StatefulSet,
	podsByOwner map[string][]*corev1.Pod,
	usage map[string]metrics.PodUsage,
) WorkloadSummary {
	var pods []*corev1.Pod
	if stateful != nil {
		key := workloadOwnerKey("StatefulSet", stateful.Namespace, stateful.Name)
		pods = podsByOwner[key]
	}
	resources := aggregateWorkloadPodResources(pods, usage)
	desired := int32(0)
	if stateful != nil && stateful.Spec.Replicas != nil {
		desired = *stateful.Spec.Replicas
	}
	ready := int32(0)
	if stateful != nil {
		ready = stateful.Status.ReadyReplicas
	}

	return WorkloadSummary{
		Kind:       "StatefulSet",
		Name:       stateful.Name,
		Namespace:  stateful.Namespace,
		Ready:      fmt.Sprintf("%d/%d", ready, desired),
		Status:     getStatefulSetStatus(stateful),
		Restarts:   resources.Restarts,
		Age:        formatAge(stateful.CreationTimestamp.Time),
		CPUUsage:   formatWorkloadCPUMilli(resources.CPUUsageMilli),
		CPURequest: formatWorkloadCPUMilli(resources.CPURequestMilli),
		CPULimit:   formatWorkloadCPUMilli(resources.CPULimitMilli),
		MemUsage:   formatWorkloadMemory(resources.MemoryUsageBytes),
		MemRequest: formatWorkloadMemory(resources.MemoryRequestBytes),
		MemLimit:   formatWorkloadMemory(resources.MemoryLimitBytes),
	}
}

func (b *NamespaceWorkloadsBuilder) buildDaemonSetSummary(
	daemon *appsv1.DaemonSet,
	podsByOwner map[string][]*corev1.Pod,
	usage map[string]metrics.PodUsage,
) WorkloadSummary {
	var pods []*corev1.Pod
	if daemon != nil {
		key := workloadOwnerKey("DaemonSet", daemon.Namespace, daemon.Name)
		pods = podsByOwner[key]
	}
	resources := aggregateWorkloadPodResources(pods, usage)
	ready := int32(0)
	desired := int32(0)
	if daemon != nil {
		ready = daemon.Status.NumberReady
		desired = daemon.Status.DesiredNumberScheduled
	}

	return WorkloadSummary{
		Kind:       "DaemonSet",
		Name:       daemon.Name,
		Namespace:  daemon.Namespace,
		Ready:      fmt.Sprintf("%d/%d", ready, desired),
		Status:     getDaemonSetStatus(daemon),
		Restarts:   resources.Restarts,
		Age:        formatAge(daemon.CreationTimestamp.Time),
		CPUUsage:   formatWorkloadCPUMilli(resources.CPUUsageMilli),
		CPURequest: formatWorkloadCPUMilli(resources.CPURequestMilli),
		CPULimit:   formatWorkloadCPUMilli(resources.CPULimitMilli),
		MemUsage:   formatWorkloadMemory(resources.MemoryUsageBytes),
		MemRequest: formatWorkloadMemory(resources.MemoryRequestBytes),
		MemLimit:   formatWorkloadMemory(resources.MemoryLimitBytes),
	}
}

func (b *NamespaceWorkloadsBuilder) buildJobSummary(
	job *batchv1.Job,
	podsByOwner map[string][]*corev1.Pod,
	usage map[string]metrics.PodUsage,
) WorkloadSummary {
	var pods []*corev1.Pod
	if job != nil {
		key := workloadOwnerKey("Job", job.Namespace, job.Name)
		pods = podsByOwner[key]
	}
	resources := aggregateWorkloadPodResources(pods, usage)
	var desired int32 = 1
	if job != nil && job.Spec.Completions != nil {
		desired = *job.Spec.Completions
	}
	completed := int32(0)
	if job != nil {
		completed = job.Status.Succeeded
	}

	return WorkloadSummary{
		Kind:       "Job",
		Name:       job.Name,
		Namespace:  job.Namespace,
		Ready:      fmt.Sprintf("%d/%d", completed, desired),
		Status:     getJobStatus(job),
		Restarts:   resources.Restarts,
		Age:        formatAge(job.CreationTimestamp.Time),
		CPUUsage:   formatWorkloadCPUMilli(resources.CPUUsageMilli),
		CPURequest: formatWorkloadCPUMilli(resources.CPURequestMilli),
		CPULimit:   formatWorkloadCPUMilli(resources.CPULimitMilli),
		MemUsage:   formatWorkloadMemory(resources.MemoryUsageBytes),
		MemRequest: formatWorkloadMemory(resources.MemoryRequestBytes),
		MemLimit:   formatWorkloadMemory(resources.MemoryLimitBytes),
	}
}

func (b *NamespaceWorkloadsBuilder) buildCronJobSummary(
	cron *batchv1.CronJob,
	podsByOwner map[string][]*corev1.Pod,
	usage map[string]metrics.PodUsage,
) WorkloadSummary {
	var pods []*corev1.Pod
	if cron != nil {
		key := workloadOwnerKey("CronJob", cron.Namespace, cron.Name)
		pods = podsByOwner[key]
	}
	resources := aggregateWorkloadPodResources(pods, usage)
	active := 0
	if cron != nil {
		active = len(cron.Status.Active)
	}

	return WorkloadSummary{
		Kind:       "CronJob",
		Name:       cron.Name,
		Namespace:  cron.Namespace,
		Ready:      fmt.Sprintf("%d", active),
		Status:     getCronJobStatus(cron),
		Restarts:   resources.Restarts,
		Age:        formatAge(cron.CreationTimestamp.Time),
		CPUUsage:   formatWorkloadCPUMilli(resources.CPUUsageMilli),
		CPURequest: formatWorkloadCPUMilli(resources.CPURequestMilli),
		CPULimit:   formatWorkloadCPUMilli(resources.CPULimitMilli),
		MemUsage:   formatWorkloadMemory(resources.MemoryUsageBytes),
		MemRequest: formatWorkloadMemory(resources.MemoryRequestBytes),
		MemLimit:   formatWorkloadMemory(resources.MemoryLimitBytes),
	}
}

func buildStandalonePodSummary(pod *corev1.Pod, usage map[string]metrics.PodUsage) WorkloadSummary {
	resources := aggregateWorkloadPodResources([]*corev1.Pod{pod}, usage)
	ready := podReadyStatus(pod)
	status := podStatus(pod)

	return WorkloadSummary{
		Kind:       "Pod",
		Name:       pod.Name,
		Namespace:  pod.Namespace,
		Ready:      ready,
		Status:     status,
		Restarts:   resources.Restarts,
		Age:        formatAge(pod.CreationTimestamp.Time),
		CPUUsage:   formatWorkloadCPUMilli(resources.CPUUsageMilli),
		CPURequest: formatWorkloadCPUMilli(resources.CPURequestMilli),
		CPULimit:   formatWorkloadCPUMilli(resources.CPULimitMilli),
		MemUsage:   formatWorkloadMemory(resources.MemoryUsageBytes),
		MemRequest: formatWorkloadMemory(resources.MemoryRequestBytes),
		MemLimit:   formatWorkloadMemory(resources.MemoryLimitBytes),
	}
}

type resourceTotals struct {
	CPURequestMilli    int64
	CPULimitMilli      int64
	CPUUsageMilli      int64
	MemoryRequestBytes int64
	MemoryLimitBytes   int64
	MemoryUsageBytes   int64
	Restarts           int32
}

func aggregateWorkloadPodResources(pods []*corev1.Pod, usage map[string]metrics.PodUsage) resourceTotals {
	var totals resourceTotals
	for _, pod := range pods {
		if pod == nil {
			continue
		}
		if pod.Status.Phase == corev1.PodSucceeded || pod.Status.Phase == corev1.PodFailed {
			continue
		}

		for _, status := range pod.Status.ContainerStatuses {
			totals.Restarts += status.RestartCount
		}

		for _, container := range pod.Spec.Containers {
			if req := container.Resources.Requests; req != nil {
				if cpu, ok := req[corev1.ResourceCPU]; ok {
					totals.CPURequestMilli += cpu.MilliValue()
				}
				if mem, ok := req[corev1.ResourceMemory]; ok {
					totals.MemoryRequestBytes += mem.Value()
				}
			}
			if lim := container.Resources.Limits; lim != nil {
				if cpu, ok := lim[corev1.ResourceCPU]; ok {
					totals.CPULimitMilli += cpu.MilliValue()
				}
				if mem, ok := lim[corev1.ResourceMemory]; ok {
					totals.MemoryLimitBytes += mem.Value()
				}
			}
		}

		key := fmt.Sprintf("%s/%s", pod.Namespace, pod.Name)
		if usageSample, ok := usage[key]; ok {
			totals.CPUUsageMilli += usageSample.CPUUsageMilli
			totals.MemoryUsageBytes += usageSample.MemoryUsageBytes
		}
	}
	return totals
}

func workloadOwnerKey(kind, namespace, name string) string {
	return fmt.Sprintf("%s/%s/%s", namespace, kind, name)
}

func ownerKeyForPod(pod *corev1.Pod) string {
	if pod == nil {
		return ""
	}
	for _, owner := range pod.OwnerReferences {
		if owner.Controller != nil && *owner.Controller {
			kind := owner.Kind
			name := owner.Name
			if owner.Kind == "ReplicaSet" {
				if base := deploymentNameFromReplicaSet(owner.Name); base != "" {
					kind = "Deployment"
					name = base
				}
			}
			return workloadOwnerKey(kind, pod.Namespace, name)
		}
	}
	return ""
}

func deploymentNameFromReplicaSet(name string) string {
	if name == "" {
		return ""
	}
	idx := strings.LastIndex(name, "-")
	if idx <= 0 {
		return ""
	}
	return name[:idx]
}

func podReadyStatus(pod *corev1.Pod) string {
	if pod == nil {
		return "0/0"
	}
	ready := 0
	total := len(pod.Status.ContainerStatuses)
	for _, status := range pod.Status.ContainerStatuses {
		if status.Ready {
			ready++
		}
	}
	return fmt.Sprintf("%d/%d", ready, total)
}

func (b *NamespaceWorkloadsBuilder) listPods(namespace string) ([]*corev1.Pod, error) {
	if namespace == "" {
		return b.podLister.List(labels.Everything())
	}
	return b.podLister.Pods(namespace).List(labels.Everything())
}

func (b *NamespaceWorkloadsBuilder) listDeployments(namespace string) ([]*appsv1.Deployment, error) {
	if namespace == "" {
		return b.deploymentLister.List(labels.Everything())
	}
	return b.deploymentLister.Deployments(namespace).List(labels.Everything())
}

func (b *NamespaceWorkloadsBuilder) listStatefulSets(namespace string) ([]*appsv1.StatefulSet, error) {
	if namespace == "" {
		return b.statefulLister.List(labels.Everything())
	}
	return b.statefulLister.StatefulSets(namespace).List(labels.Everything())
}

func (b *NamespaceWorkloadsBuilder) listDaemonSets(namespace string) ([]*appsv1.DaemonSet, error) {
	if namespace == "" {
		return b.daemonLister.List(labels.Everything())
	}
	return b.daemonLister.DaemonSets(namespace).List(labels.Everything())
}

func (b *NamespaceWorkloadsBuilder) listJobs(namespace string) ([]*batchv1.Job, error) {
	if namespace == "" {
		return b.jobLister.List(labels.Everything())
	}
	return b.jobLister.Jobs(namespace).List(labels.Everything())
}

func (b *NamespaceWorkloadsBuilder) listCronJobs(namespace string) ([]*batchv1.CronJob, error) {
	if namespace == "" {
		return b.cronJobLister.List(labels.Everything())
	}
	return b.cronJobLister.CronJobs(namespace).List(labels.Everything())
}
func podStatus(pod *corev1.Pod) string {
	if pod == nil {
		return "Unknown"
	}
	if pod.Status.Reason != "" {
		return pod.Status.Reason
	}
	return string(pod.Status.Phase)
}

func formatWorkloadCPUMilli(value int64) string {
	if value <= 0 {
		return "-"
	}
	if value < 1000 {
		return fmt.Sprintf("%dm", value)
	}
	return fmt.Sprintf("%.2f", float64(value)/1000)
}

func formatWorkloadMemory(value int64) string {
	if value <= 0 {
		return "-"
	}
	const (
		ki = 1024
		mi = ki * 1024
		gi = mi * 1024
	)
	if value >= gi {
		return fmt.Sprintf("%.2fGi", float64(value)/float64(gi))
	}
	if value >= mi {
		return fmt.Sprintf("%.0fMi", float64(value)/float64(mi))
	}
	if value >= ki {
		return fmt.Sprintf("%.0fKi", float64(value)/float64(ki))
	}
	return fmt.Sprintf("%d", value)
}

// Status helper functions replicated from the legacy workload builder.
func getDeploymentStatus(d *appsv1.Deployment) string {
	if d == nil {
		return "Unknown"
	}
	if d.Status.Replicas == 0 {
		return "Scaled to 0"
	}
	if d.Spec.Replicas != nil && d.Status.ReadyReplicas == *d.Spec.Replicas {
		return "Running"
	}
	if d.Status.ReadyReplicas > 0 {
		return "Updating"
	}
	return "Pending"
}

func getStatefulSetStatus(s *appsv1.StatefulSet) string {
	if s == nil {
		return "Unknown"
	}
	if s.Status.Replicas == 0 {
		return "Scaled to 0"
	}
	if s.Spec.Replicas != nil && s.Status.ReadyReplicas == *s.Spec.Replicas {
		return "Running"
	}
	if s.Status.ReadyReplicas > 0 {
		return "Updating"
	}
	return "Pending"
}

func getDaemonSetStatus(d *appsv1.DaemonSet) string {
	if d == nil {
		return "Unknown"
	}
	if d.Status.NumberReady == d.Status.DesiredNumberScheduled {
		return "Running"
	}
	if d.Status.NumberReady > 0 {
		return "Updating"
	}
	return "Pending"
}

func getJobStatus(j *batchv1.Job) string {
	if j == nil {
		return "Unknown"
	}
	if j.Status.Succeeded > 0 {
		return "Completed"
	}
	if j.Status.Failed > 0 {
		return "Failed"
	}
	if j.Status.Active > 0 {
		return "Running"
	}
	return "Pending"
}

func getCronJobStatus(c *batchv1.CronJob) string {
	if c == nil {
		return "Unknown"
	}
	if c.Spec.Suspend != nil && *c.Spec.Suspend {
		return "Suspended"
	}
	if len(c.Status.Active) > 0 {
		return "Active"
	}
	return "Idle"
}
