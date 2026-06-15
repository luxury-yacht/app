// backend/refresh/snapshot/namespace_workloads.go
//
// Builds namespace workload refresh snapshots and projects the row facts needed
// by workload tables, stream rows, and object-action surfaces.
package snapshot

import (
	"context"
	"errors"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"

	"github.com/luxury-yacht/app/backend/resources/common"
	appsv1 "k8s.io/api/apps/v1"
	autoscalingv1 "k8s.io/api/autoscaling/v1"
	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/labels"
	"k8s.io/apimachinery/pkg/runtime/schema"
	informers "k8s.io/client-go/informers"
	appslisters "k8s.io/client-go/listers/apps/v1"
	autoscalinglisters "k8s.io/client-go/listers/autoscaling/v1"
	batchlisters "k8s.io/client-go/listers/batch/v1"
	corelisters "k8s.io/client-go/listers/core/v1"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/containerlogsstream"
	"github.com/luxury-yacht/app/backend/refresh/domain"
	"github.com/luxury-yacht/app/backend/refresh/metrics"
	"github.com/luxury-yacht/app/backend/resourcemodel"
)

const (
	namespaceWorkloadsDomainName = "namespace-workloads"
	errNamespaceScopeRequired    = "namespace scope is required"
)

// NamespaceWorkloadsPermissions indicates which resources should be included in the domain.
type NamespaceWorkloadsPermissions struct {
	IncludePods         bool
	IncludeDeployments  bool
	IncludeStatefulSets bool
	IncludeDaemonSets   bool
	IncludeJobs         bool
	IncludeCronJobs     bool
}

// NamespaceWorkloadsBuilder constructs namespace-scoped workload snapshots.
type NamespaceWorkloadsBuilder struct {
	podLister        corelisters.PodLister
	deploymentLister appslisters.DeploymentLister
	statefulLister   appslisters.StatefulSetLister
	daemonLister     appslisters.DaemonSetLister
	jobLister        batchlisters.JobLister
	cronJobLister    batchlisters.CronJobLister
	hpaLister        autoscalinglisters.HorizontalPodAutoscalerLister
	metrics          metrics.Provider
	logger           containerlogsstream.Logger
}

// NamespaceWorkloadsSnapshot is returned to the frontend.
type NamespaceWorkloadsSnapshot struct {
	ClusterMeta
	ResourceQueryEnvelope
	Rows []WorkloadSummary `json:"rows"`
}

func namespaceWorkloadsQueryCapabilities() ResourceQueryCapabilities {
	return newTypedResourceCapabilities(
		[]string{"name", "kind", "namespace", "status", "ready", "restarts", "cpu", "memory", "age"},
		[]string{"kinds", "namespaces"},
		[]string{"kind", "name", "namespace", "status", "ready"},
		[]string{"Pod", "Deployment", "StatefulSet", "DaemonSet", "Job", "CronJob"},
	)
}

// WorkloadSummary mirrors the data required by the workloads table.
type WorkloadSummary struct {
	ClusterMeta
	Kind                 string `json:"kind"`
	Name                 string `json:"name"`
	Namespace            string `json:"namespace"`
	Ready                string `json:"ready"`
	Status               string `json:"status"`
	StatusState          string `json:"statusState,omitempty"`
	StatusPresentation   string `json:"statusPresentation,omitempty"`
	StatusReason         string `json:"statusReason,omitempty"`
	Restarts             int32  `json:"restarts"`
	Age                  string `json:"age"`
	AgeTimestamp         int64  `json:"ageTimestamp,omitempty"`
	CPUUsage             string `json:"cpuUsage,omitempty"`
	CPURequest           string `json:"cpuRequest,omitempty"`
	CPULimit             string `json:"cpuLimit,omitempty"`
	MemUsage             string `json:"memUsage,omitempty"`
	MemRequest           string `json:"memRequest,omitempty"`
	MemLimit             string `json:"memLimit,omitempty"`
	PortForwardAvailable bool   `json:"portForwardAvailable"`
	DesiredReplicas      *int32 `json:"desiredReplicas,omitempty"`
	// HPAManaged indicates whether a HorizontalPodAutoscaler targets this workload.
	// Nil means HPA coverage was unavailable, so action surfaces must fail closed.
	HPAManaged *bool `json:"hpaManaged,omitempty"`
}

// RegisterNamespaceWorkloadsDomain wires the workloads domain into the registry.
// Only listers for permitted resources are wired; denied resources are left nil
// so the builder skips them gracefully.
func RegisterNamespaceWorkloadsDomain(
	reg *domain.Registry,
	factory informers.SharedInformerFactory,
	provider metrics.Provider,
	logger containerlogsstream.Logger,
	perms NamespaceWorkloadsPermissions,
) error {
	if factory == nil {
		return fmt.Errorf("shared informer factory is nil")
	}
	builder := &NamespaceWorkloadsBuilder{
		// HPA lister is always wired — it's informational and doesn't block on missing perms.
		hpaLister: factory.Autoscaling().V1().HorizontalPodAutoscalers().Lister(),
		metrics:   provider,
		logger:    logger,
	}
	if perms.IncludePods {
		builder.podLister = factory.Core().V1().Pods().Lister()
	}
	if perms.IncludeDeployments {
		builder.deploymentLister = factory.Apps().V1().Deployments().Lister()
	}
	if perms.IncludeStatefulSets {
		builder.statefulLister = factory.Apps().V1().StatefulSets().Lister()
	}
	if perms.IncludeDaemonSets {
		builder.daemonLister = factory.Apps().V1().DaemonSets().Lister()
	}
	if perms.IncludeJobs {
		builder.jobLister = factory.Batch().V1().Jobs().Lister()
	}
	if perms.IncludeCronJobs {
		builder.cronJobLister = factory.Batch().V1().CronJobs().Lister()
	}
	return reg.Register(refresh.DomainConfig{
		Name:          namespaceWorkloadsDomainName,
		BuildSnapshot: builder.Build,
	})
}

// Build assembles workload summaries for the requested namespace scope.
func (b *NamespaceWorkloadsBuilder) Build(ctx context.Context, scope string) (*refresh.Snapshot, error) {
	meta := ClusterMetaFromContext(ctx)
	clusterID, trimmed := refresh.SplitClusterScope(scope)
	dynamicRevision := b.workloadsDynamicRevision()
	baseScope, query, err := parseTypedTableQueryScope(clusterID, strings.TrimSpace(trimmed), namespaceWorkloadsDomainName, dynamicRevision)
	if err != nil {
		return nil, err
	}
	parsedScope, err := parseNamespaceSnapshotScope(refresh.JoinClusterScope(clusterID, baseScope), errNamespaceScopeRequired)
	if err != nil {
		return nil, err
	}
	namespace := parsedScope.Namespace
	issues := b.queryIssues(ctx, query)

	var pods []*corev1.Pod
	if b.podLister != nil && runtimeResourceAllowed(ctx, namespaceWorkloadsDomainName, "", "pods") {
		pods, err = b.listPods(namespace)
		if err != nil {
			return nil, fmt.Errorf("namespace workloads: failed to list pods: %w", err)
		}
	}
	var deployments []*appsv1.Deployment
	if b.deploymentLister != nil && runtimeResourceAllowed(ctx, namespaceWorkloadsDomainName, "apps", "deployments") {
		deployments, err = b.listDeployments(namespace)
		if err != nil {
			return nil, fmt.Errorf("namespace workloads: failed to list deployments: %w", err)
		}
	}
	var statefulSets []*appsv1.StatefulSet
	if b.statefulLister != nil && runtimeResourceAllowed(ctx, namespaceWorkloadsDomainName, "apps", "statefulsets") {
		statefulSets, err = b.listStatefulSets(namespace)
		if err != nil {
			return nil, fmt.Errorf("namespace workloads: failed to list statefulsets: %w", err)
		}
	}
	var daemonSets []*appsv1.DaemonSet
	if b.daemonLister != nil && runtimeResourceAllowed(ctx, namespaceWorkloadsDomainName, "apps", "daemonsets") {
		daemonSets, err = b.listDaemonSets(namespace)
		if err != nil {
			return nil, fmt.Errorf("namespace workloads: failed to list daemonsets: %w", err)
		}
	}
	var jobs []*batchv1.Job
	if b.jobLister != nil && runtimeResourceAllowed(ctx, namespaceWorkloadsDomainName, "batch", "jobs") {
		jobs, err = b.listJobs(namespace)
		if err != nil {
			return nil, fmt.Errorf("namespace workloads: failed to list jobs: %w", err)
		}
	}
	var cronJobs []*batchv1.CronJob
	if b.cronJobLister != nil && runtimeResourceAllowed(ctx, namespaceWorkloadsDomainName, "batch", "cronjobs") {
		cronJobs, err = b.listCronJobs(namespace)
		if err != nil {
			return nil, fmt.Errorf("namespace workloads: failed to list cronjobs: %w", err)
		}
	}

	// List HPAs to mark workloads that are managed by an autoscaler. If this
	// coverage is unavailable, leave ownership unknown instead of emitting false.
	hpas, hpaErr := b.listHPAs(namespace)

	snapshot, err := b.buildSnapshot(meta, refresh.JoinClusterScope(clusterID, strings.TrimSpace(trimmed)), query, pods, deployments, statefulSets, daemonSets, jobs, cronJobs, hpas, hpaErr == nil, issues)
	if err != nil {
		return nil, err
	}
	snapshot.Version = snapshotVersionWithDynamicRevision(snapshot.Version, dynamicRevision)
	return snapshot, nil
}
func (b *NamespaceWorkloadsBuilder) buildSnapshot(
	meta ClusterMeta,
	scope string,
	query typedTableQuery,
	pods []*corev1.Pod,
	deployments []*appsv1.Deployment,
	statefulSets []*appsv1.StatefulSet,
	daemonSets []*appsv1.DaemonSet,
	jobs []*batchv1.Job,
	cronJobs []*batchv1.CronJob,
	hpas []*autoscalingv1.HorizontalPodAutoscaler,
	hpaKnown bool,
	issues []ResourceQueryIssue,
) (*refresh.Snapshot, error) {
	podUsage := map[string]metrics.PodUsage{}
	if b.metrics != nil {
		podUsage = b.metrics.LatestPodUsage()
	}

	// Build a set of HPA-managed workloads keyed by full target GVK + namespace/name.
	hpaTargets := buildHPATargetSet(hpas)

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
		items           []WorkloadSummary
		version         uint64
		processedOwners = map[string]struct{}{}
	)
	var queryCollector *typedTableQueryCollector[WorkloadSummary]
	if query.Enabled {
		queryCollector = newTypedTableQueryCollector(query, workloadTableQueryAdapter())
	}

	appendSummary := func(summary WorkloadSummary, obj metav1.Object) {
		summary.ClusterMeta = meta
		// Mark as HPA-managed only when the HPA target carries the same full
		// GVK. Kind/name-only matching can collide with custom resources.
		if hpaKnown {
			managed := false
			if _, ok := hpaTargets[workloadHPATargetKey(summary)]; ok {
				managed = true
			}
			summary.HPAManaged = &managed
		}
		if summary.Kind != "Pod" {
			processedOwners[workloadOwnerKey(summary.Kind, summary.Namespace, summary.Name)] = struct{}{}
		}
		if queryCollector != nil {
			queryCollector.Add(summary)
		} else {
			items = append(items, summary)
		}
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
		summary := b.buildDeploymentSummary(meta.ClusterID, deployment, podsByOwner, podUsage)
		appendSummary(summary, deployment)
	}

	for _, stateful := range statefulSets {
		if stateful == nil {
			continue
		}
		summary := b.buildStatefulSetSummary(meta.ClusterID, stateful, podsByOwner, podUsage)
		appendSummary(summary, stateful)
	}

	for _, daemon := range daemonSets {
		if daemon == nil {
			continue
		}
		summary := b.buildDaemonSetSummary(meta.ClusterID, daemon, podsByOwner, podUsage)
		appendSummary(summary, daemon)
	}

	for _, job := range jobs {
		if job == nil {
			continue
		}
		summary := b.buildJobSummary(meta.ClusterID, job, podsByOwner, podUsage)
		appendSummary(summary, job)
	}

	for _, cron := range cronJobs {
		if cron == nil {
			continue
		}
		summary := b.buildCronJobSummary(meta.ClusterID, cron, podsByOwner, podUsage)
		appendSummary(summary, cron)
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
		summary := buildStandalonePodSummary(meta.ClusterID, pod, podUsage)
		appendSummary(summary, pod)
	}

	if query.Enabled {
		page := queryCollector.Page()
		exact := len(issues) == 0
		return &refresh.Snapshot{
			Domain:  namespaceWorkloadsDomainName,
			Scope:   scope,
			Version: version,
			Payload: NamespaceWorkloadsSnapshot{
				ClusterMeta:           meta,
				ResourceQueryEnvelope: typedQueryEnvelope(namespaceWorkloadsDomainName, page, b.queryCapabilities()).withDegraded(exact, issues),
				Rows:                  page.Rows,
			},
			Stats: refresh.SnapshotStats{
				ItemCount: len(page.Rows),
			},
		}, nil
	}

	sortWorkloadSummaries(items)

	totalItems := len(items)
	if totalItems > config.SnapshotNamespaceWorkloadsEntryLimit {
		items = items[:config.SnapshotNamespaceWorkloadsEntryLimit]
	}
	stats := snapshotWindowStats(len(items), totalItems, "workloads")

	return &refresh.Snapshot{
		Domain:  namespaceWorkloadsDomainName,
		Scope:   scope,
		Version: version,
		Payload: NamespaceWorkloadsSnapshot{
			ClusterMeta:           meta,
			ResourceQueryEnvelope: typedWindowEnvelope(namespaceWorkloadsDomainName, totalItems, !stats.Truncated && len(issues) == 0, snapshotSortedKinds(items, func(item WorkloadSummary) string { return item.Kind }), b.queryCapabilities()).withIssues(issues),
			Rows:                  items,
		},
		Stats: stats,
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

func (b *NamespaceWorkloadsBuilder) resourceSources() []typedTableResourceSource {
	return []typedTableResourceSource{
		{
			Kind:       "Pod",
			Group:      "",
			Resource:   "pods",
			Available:  b.podLister != nil,
			QueryKinds: []string{"Pod", "Deployment", "StatefulSet", "DaemonSet", "Job", "CronJob"},
		},
		{Kind: "Deployment", Group: "apps", Resource: "deployments", Available: b.deploymentLister != nil},
		{Kind: "StatefulSet", Group: "apps", Resource: "statefulsets", Available: b.statefulLister != nil},
		{Kind: "DaemonSet", Group: "apps", Resource: "daemonsets", Available: b.daemonLister != nil},
		{Kind: "Job", Group: "batch", Resource: "jobs", Available: b.jobLister != nil},
		{Kind: "CronJob", Group: "batch", Resource: "cronjobs", Available: b.cronJobLister != nil},
	}
}

// queryCapabilities narrows the family vocabulary to the kinds whose backing
// listers exist (see capabilitiesWithAvailableKinds).
func (b *NamespaceWorkloadsBuilder) queryCapabilities() ResourceQueryCapabilities {
	return capabilitiesWithAvailableKinds(namespaceWorkloadsQueryCapabilities(), b.resourceSources())
}

func (b *NamespaceWorkloadsBuilder) queryIssues(ctx context.Context, query typedTableQuery) []ResourceQueryIssue {
	return typedTableQueryResourceIssues(ctx, namespaceWorkloadsDomainName, query, b.resourceSources())
}

func (b *NamespaceWorkloadsBuilder) workloadsDynamicRevision() string {
	if b.metrics == nil {
		return ""
	}
	metadata := b.metrics.Metadata()
	if metadata.CollectedAt.IsZero() {
		return ""
	}
	return strconv.FormatInt(metadata.CollectedAt.UnixNano(), 10)
}

func workloadTableQueryAdapter() typedTableQueryAdapter[WorkloadSummary] {
	return typedTableQueryAdapter[WorkloadSummary]{
		Key: func(row WorkloadSummary) string {
			return fmt.Sprintf("%s/%s/%s", strings.ToLower(row.Kind), strings.ToLower(row.Namespace), strings.ToLower(row.Name))
		},
		Namespace: func(row WorkloadSummary) string { return row.Namespace },
		Kind:      func(row WorkloadSummary) string { return row.Kind },
		SearchText: func(row WorkloadSummary) []string {
			return []string{
				row.Kind,
				row.Name,
				row.Namespace,
				row.Status,
				row.Ready,
			}
		},
		Predicate: func(row WorkloadSummary, field, value string) bool {
			switch strings.ToLower(strings.TrimSpace(field)) {
			case "health":
				switch strings.ToLower(strings.TrimSpace(value)) {
				case "restarts":
					return row.Restarts > 0
				case "not-ready":
					ready, total, ok := parseReadyPair(row.Ready)
					return ok && total > 0 && ready < total
				case "unhealthy":
					presentation := strings.ToLower(strings.TrimSpace(row.StatusPresentation))
					return presentation == "warning" || presentation == "error" || presentation == "not-ready"
				default:
					return true
				}
			default:
				return true
			}
		},
		SortValue: func(row WorkloadSummary, field string) string {
			switch strings.ToLower(field) {
			case "kind":
				return row.Kind
			case "namespace":
				return row.Namespace
			case "status":
				return row.Status
			case "ready":
				return row.Ready
			case "restarts":
				return strconv.Itoa(int(row.Restarts))
			case "cpu":
				return row.CPUUsage
			case "memory":
				return row.MemUsage
			case "age":
				return row.Age
			default:
				return row.Name
			}
		},
		NumericSort: func(row WorkloadSummary, field string) (float64, bool) {
			switch strings.ToLower(field) {
			case "cpu":
				return parseFormattedCPUToMilli(row.CPUUsage)
			case "memory":
				return parseFormattedMemoryToBytes(row.MemUsage)
			case "restarts":
				return float64(row.Restarts), true
			case "ready":
				ready, total, ok := parseReadyPair(row.Ready)
				if !ok {
					// Keep "ready" uniformly numeric so the page sort and keyset
					// cursor agree; an unparseable pair sorts first ascending.
					return math.Inf(-1), true
				}
				return float64(ready*1000000 + total), true
			case "age":
				return numericAgeSortValue(row.AgeTimestamp)
			default:
				return 0, false
			}
		},
	}
}

func (b *NamespaceWorkloadsBuilder) buildDeploymentSummary(
	clusterID string,
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
	readyStatus := workloadPodReadyStatus(pods, ready, desired)
	model := resourcemodel.BuildDeploymentResourceModel(clusterID, deployment)

	return WorkloadSummary{
		Kind:                 "Deployment",
		Name:                 deployment.Name,
		Namespace:            deployment.Namespace,
		Ready:                readyStatus,
		Status:               model.Status.Label,
		StatusState:          model.Status.State,
		StatusPresentation:   model.Status.Presentation,
		StatusReason:         model.Status.Reason,
		Restarts:             resources.Restarts,
		Age:                  formatAge(deployment.CreationTimestamp.Time),
		AgeTimestamp:         creationTimestampMillis(deployment),
		CPUUsage:             formatWorkloadCPUMilli(resources.CPUUsageMilli),
		CPURequest:           formatWorkloadCPUMilli(resources.CPURequestMilli),
		CPULimit:             formatWorkloadCPUMilli(resources.CPULimitMilli),
		MemUsage:             formatWorkloadMemory(resources.MemoryUsageBytes),
		MemRequest:           formatWorkloadMemory(resources.MemoryRequestBytes),
		MemLimit:             formatWorkloadMemory(resources.MemoryLimitBytes),
		PortForwardAvailable: common.HasForwardableContainerPorts(deployment.Spec.Template.Spec.Containers),
		DesiredReplicas:      cloneInt32Ptr(deployment.Spec.Replicas),
	}
}

func (b *NamespaceWorkloadsBuilder) buildStatefulSetSummary(
	clusterID string,
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
	readyStatus := workloadPodReadyStatus(pods, ready, desired)
	model := resourcemodel.BuildStatefulSetResourceModel(clusterID, stateful)

	return WorkloadSummary{
		Kind:                 "StatefulSet",
		Name:                 stateful.Name,
		Namespace:            stateful.Namespace,
		Ready:                readyStatus,
		Status:               model.Status.Label,
		StatusState:          model.Status.State,
		StatusPresentation:   model.Status.Presentation,
		StatusReason:         model.Status.Reason,
		Restarts:             resources.Restarts,
		Age:                  formatAge(stateful.CreationTimestamp.Time),
		AgeTimestamp:         creationTimestampMillis(stateful),
		CPUUsage:             formatWorkloadCPUMilli(resources.CPUUsageMilli),
		CPURequest:           formatWorkloadCPUMilli(resources.CPURequestMilli),
		CPULimit:             formatWorkloadCPUMilli(resources.CPULimitMilli),
		MemUsage:             formatWorkloadMemory(resources.MemoryUsageBytes),
		MemRequest:           formatWorkloadMemory(resources.MemoryRequestBytes),
		MemLimit:             formatWorkloadMemory(resources.MemoryLimitBytes),
		PortForwardAvailable: common.HasForwardableContainerPorts(stateful.Spec.Template.Spec.Containers),
		DesiredReplicas:      cloneInt32Ptr(stateful.Spec.Replicas),
	}
}

func (b *NamespaceWorkloadsBuilder) buildDaemonSetSummary(
	clusterID string,
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
	readyStatus := workloadPodReadyStatus(pods, ready, desired)
	model := resourcemodel.BuildDaemonSetResourceModel(clusterID, daemon)

	return WorkloadSummary{
		Kind:                 "DaemonSet",
		Name:                 daemon.Name,
		Namespace:            daemon.Namespace,
		Ready:                readyStatus,
		Status:               model.Status.Label,
		StatusState:          model.Status.State,
		StatusPresentation:   model.Status.Presentation,
		StatusReason:         model.Status.Reason,
		Restarts:             resources.Restarts,
		Age:                  formatAge(daemon.CreationTimestamp.Time),
		AgeTimestamp:         creationTimestampMillis(daemon),
		CPUUsage:             formatWorkloadCPUMilli(resources.CPUUsageMilli),
		CPURequest:           formatWorkloadCPUMilli(resources.CPURequestMilli),
		CPULimit:             formatWorkloadCPUMilli(resources.CPULimitMilli),
		MemUsage:             formatWorkloadMemory(resources.MemoryUsageBytes),
		MemRequest:           formatWorkloadMemory(resources.MemoryRequestBytes),
		MemLimit:             formatWorkloadMemory(resources.MemoryLimitBytes),
		PortForwardAvailable: common.HasForwardableContainerPorts(daemon.Spec.Template.Spec.Containers),
	}
}

func (b *NamespaceWorkloadsBuilder) buildJobSummary(
	clusterID string,
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
	model := resourcemodel.BuildJobResourceModel(clusterID, job)

	return WorkloadSummary{
		Kind:                 "Job",
		Name:                 job.Name,
		Namespace:            job.Namespace,
		Ready:                fmt.Sprintf("%d/%d", completed, desired),
		Status:               model.Status.Label,
		StatusState:          model.Status.State,
		StatusPresentation:   model.Status.Presentation,
		StatusReason:         model.Status.Reason,
		Restarts:             resources.Restarts,
		Age:                  formatAge(job.CreationTimestamp.Time),
		AgeTimestamp:         creationTimestampMillis(job),
		CPUUsage:             formatWorkloadCPUMilli(resources.CPUUsageMilli),
		CPURequest:           formatWorkloadCPUMilli(resources.CPURequestMilli),
		CPULimit:             formatWorkloadCPUMilli(resources.CPULimitMilli),
		MemUsage:             formatWorkloadMemory(resources.MemoryUsageBytes),
		MemRequest:           formatWorkloadMemory(resources.MemoryRequestBytes),
		MemLimit:             formatWorkloadMemory(resources.MemoryLimitBytes),
		PortForwardAvailable: common.HasForwardableContainerPorts(job.Spec.Template.Spec.Containers),
	}
}

func (b *NamespaceWorkloadsBuilder) buildCronJobSummary(
	clusterID string,
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
	model := resourcemodel.BuildCronJobResourceModel(clusterID, cron)

	return WorkloadSummary{
		Kind:                 "CronJob",
		Name:                 cron.Name,
		Namespace:            cron.Namespace,
		Ready:                fmt.Sprintf("%d", active),
		Status:               model.Status.Label,
		StatusState:          model.Status.State,
		StatusPresentation:   model.Status.Presentation,
		StatusReason:         model.Status.Reason,
		Restarts:             resources.Restarts,
		Age:                  formatAge(cron.CreationTimestamp.Time),
		AgeTimestamp:         creationTimestampMillis(cron),
		CPUUsage:             formatWorkloadCPUMilli(resources.CPUUsageMilli),
		CPURequest:           formatWorkloadCPUMilli(resources.CPURequestMilli),
		CPULimit:             formatWorkloadCPUMilli(resources.CPULimitMilli),
		MemUsage:             formatWorkloadMemory(resources.MemoryUsageBytes),
		MemRequest:           formatWorkloadMemory(resources.MemoryRequestBytes),
		MemLimit:             formatWorkloadMemory(resources.MemoryLimitBytes),
		PortForwardAvailable: common.HasForwardableContainerPorts(cron.Spec.JobTemplate.Spec.Template.Spec.Containers),
	}
}

func buildStandalonePodSummary(clusterID string, pod *corev1.Pod, usage map[string]metrics.PodUsage) WorkloadSummary {
	resources := aggregateWorkloadPodResources([]*corev1.Pod{pod}, usage)
	ready := podReadyStatus(pod)
	model := resourcemodel.BuildPodResourceModel(clusterID, pod)

	return WorkloadSummary{
		Kind:                 "Pod",
		Name:                 pod.Name,
		Namespace:            pod.Namespace,
		Ready:                ready,
		Status:               model.Status.Label,
		StatusState:          model.Status.State,
		StatusPresentation:   model.Status.Presentation,
		StatusReason:         model.Status.Reason,
		Restarts:             resources.Restarts,
		Age:                  formatAge(pod.CreationTimestamp.Time),
		AgeTimestamp:         creationTimestampMillis(pod),
		CPUUsage:             formatWorkloadCPUMilli(resources.CPUUsageMilli),
		CPURequest:           formatWorkloadCPUMilli(resources.CPURequestMilli),
		CPULimit:             formatWorkloadCPUMilli(resources.CPULimitMilli),
		MemUsage:             formatWorkloadMemory(resources.MemoryUsageBytes),
		MemRequest:           formatWorkloadMemory(resources.MemoryRequestBytes),
		MemLimit:             formatWorkloadMemory(resources.MemoryLimitBytes),
		PortForwardAvailable: hasForwardablePodPorts(pod),
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

		totals.Restarts += resourcemodel.BuildPodFacts(pod).RestartCount

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
	facts := resourcemodel.BuildPodFacts(pod)
	return fmt.Sprintf("%d/%d", facts.ReadyContainers, facts.TotalContainers)
}

func workloadPodReadyStatus(pods []*corev1.Pod, fallbackReady, fallbackTotal int32) string {
	readyPods := int32(0)
	totalPods := int32(0)
	for _, pod := range pods {
		if pod == nil {
			continue
		}
		if pod.Status.Phase == corev1.PodSucceeded || pod.Status.Phase == corev1.PodFailed {
			continue
		}
		totalPods++
		facts := resourcemodel.BuildPodFacts(pod)
		if facts.TotalContainers > 0 && facts.ReadyContainers >= facts.TotalContainers {
			readyPods++
		}
	}
	if totalPods == 0 && fallbackTotal > 0 {
		return fmt.Sprintf("%d/%d", fallbackReady, fallbackTotal)
	}
	return fmt.Sprintf("%d/%d", readyPods, totalPods)
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

// listHPAs lists HorizontalPodAutoscalers in the given namespace (or all if empty).
func (b *NamespaceWorkloadsBuilder) listHPAs(namespace string) ([]*autoscalingv1.HorizontalPodAutoscaler, error) {
	if b.hpaLister == nil {
		return nil, errors.New("hpa lister unavailable")
	}
	if namespace == "" {
		return b.hpaLister.List(labels.Everything())
	}
	return b.hpaLister.HorizontalPodAutoscalers(namespace).List(labels.Everything())
}

// buildHPATargetSet returns a set of full GVK + namespace/name keys for
// workloads targeted by a HorizontalPodAutoscaler.
func buildHPATargetSet(hpas []*autoscalingv1.HorizontalPodAutoscaler) map[string]struct{} {
	targets := make(map[string]struct{}, len(hpas))
	for _, hpa := range hpas {
		if hpa == nil {
			continue
		}
		ref := hpa.Spec.ScaleTargetRef
		gvk := schema.FromAPIVersionAndKind(ref.APIVersion, ref.Kind)
		if gvk.Empty() || strings.TrimSpace(ref.Name) == "" {
			continue
		}
		targets[hpaTargetKey(gvk.Group, gvk.Version, gvk.Kind, hpa.Namespace, ref.Name)] = struct{}{}
	}
	return targets
}

func workloadHPATargetKey(summary WorkloadSummary) string {
	switch summary.Kind {
	case "Deployment", "StatefulSet", "DaemonSet":
		return hpaTargetKey("apps", "v1", summary.Kind, summary.Namespace, summary.Name)
	case "Job", "CronJob":
		return hpaTargetKey("batch", "v1", summary.Kind, summary.Namespace, summary.Name)
	case "Pod":
		return hpaTargetKey("", "v1", summary.Kind, summary.Namespace, summary.Name)
	default:
		return hpaTargetKey("", "", summary.Kind, summary.Namespace, summary.Name)
	}
}

func hpaTargetKey(group, version, kind, namespace, name string) string {
	return fmt.Sprintf("%s/%s/%s/%s/%s", group, version, kind, namespace, name)
}

func cloneInt32Ptr(value *int32) *int32 {
	if value == nil {
		return nil
	}
	clone := *value
	return &clone
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
