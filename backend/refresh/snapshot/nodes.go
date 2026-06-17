package snapshot

import (
	"context"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/internal/parallel"
	"github.com/luxury-yacht/app/backend/internal/timeutil"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
	"github.com/luxury-yacht/app/backend/refresh/metrics"
	"github.com/luxury-yacht/app/backend/refresh/streamrows"
	nodepkg "github.com/luxury-yacht/app/backend/resources/nodes"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/labels"
	informers "k8s.io/client-go/informers"
	"k8s.io/client-go/kubernetes"
	corelisters "k8s.io/client-go/listers/core/v1"
	"k8s.io/klog/v2"
)

// NodeBuilder constructs node snapshots from informer caches.
type NodeBuilder struct {
	lister    corelisters.NodeLister
	podLister corelisters.PodLister
	metrics   metrics.Provider
}

// NodeListBuilder assembles node payloads by issuing direct list calls.
type NodeListBuilder struct {
	client  kubernetes.Interface
	metrics metrics.Provider
}

// NodeSnapshot is the payload for the nodes domain.
type NodeSnapshot struct {
	ClusterMeta
	ResourceQueryEnvelope
	Rows             []NodeSummary              `json:"rows"`
	Metrics          NodeMetricsInfo            `json:"metrics"`
	MetricsByCluster map[string]NodeMetricsInfo `json:"metricsByCluster,omitempty"`
}

func nodeQueryCapabilities() ResourceQueryCapabilities {
	return newTypedResourceCapabilities(
		[]string{"name", "kind", "status", "roles", "version", "cpu", "memory", "pods", "restarts", "age"},
		nil,
		[]string{"name", "status", "roles", "version", "internalIP", "externalIP"},
		nil, // no kind filtering
	)
}

// NodeMetricsInfo captures metadata about metrics collection.
type NodeMetricsInfo struct {
	CollectedAt         int64  `json:"collectedAt,omitempty"`
	Stale               bool   `json:"stale"`
	LastError           string `json:"lastError,omitempty"`
	ConsecutiveFailures int    `json:"consecutiveFailures,omitempty"`
	SuccessCount        uint64 `json:"successCount"`
	FailureCount        uint64 `json:"failureCount"`
}

// NodeSummary and its sub-types live in the streamrows leaf so every streaming
// row type has one home; these aliases keep the snapshot-side names and wire JSON.
type NodeSummary = streamrows.NodeSummary

// NodeTaint represents a node taint in snapshot payload.
type NodeTaint = streamrows.NodeTaint

// NodePodMetric captures realtime usage for a pod scheduled on the node.
type NodePodMetric = streamrows.NodePodMetric

// RegisterNodeDomain registers the nodes snapshot domain.
func RegisterNodeDomain(reg *domain.Registry, factory informers.SharedInformerFactory, provider metrics.Provider) error {
	builder := &NodeBuilder{
		lister:    factory.Core().V1().Nodes().Lister(),
		podLister: factory.Core().V1().Pods().Lister(),
		metrics:   provider,
	}
	return reg.Register(refresh.DomainConfig{
		Name:          "nodes",
		BuildSnapshot: builder.Build,
	})
}

// RegisterNodeDomainList registers a list-based fallback node domain.
func RegisterNodeDomainList(reg *domain.Registry, client kubernetes.Interface, provider metrics.Provider) error {
	if client == nil {
		return fmt.Errorf("nodes: kubernetes client is nil")
	}
	builder := &NodeListBuilder{
		client:  client,
		metrics: provider,
	}
	return reg.Register(refresh.DomainConfig{
		Name:          "nodes",
		BuildSnapshot: builder.Build,
	})
}

// Build returns the node snapshot payload.
func (b *NodeBuilder) Build(ctx context.Context, scope string) (*refresh.Snapshot, error) {
	list, err := b.lister.List(labels.Everything())
	if err != nil {
		return nil, err
	}
	pods := []*corev1.Pod{}
	if b.podLister != nil {
		podList, err := b.podLister.List(labels.Everything())
		if err != nil {
			return nil, err
		}
		pods = append(pods, podList...)
	}
	return buildNodeSnapshot(ctx, scope, list, pods, b.metrics)
}

// Build returns the node snapshot payload using direct list API calls.
func (b *NodeListBuilder) Build(ctx context.Context, scope string) (*refresh.Snapshot, error) {
	var (
		nodes         []*corev1.Node
		pods          []*corev1.Pod
		podsForbidden bool
		mu            sync.Mutex
	)

	tasks := []func(context.Context) error{
		func(ctx context.Context) error {
			resp, err := b.client.CoreV1().Nodes().List(ctx, metav1.ListOptions{})
			if err != nil {
				return err
			}
			mu.Lock()
			nodes = parallel.CopyToPointers(resp.Items)
			mu.Unlock()
			return nil
		},
		func(ctx context.Context) error {
			resp, err := b.client.CoreV1().Pods("").List(ctx, metav1.ListOptions{})
			switch {
			case err == nil:
				mu.Lock()
				pods = parallel.CopyToPointers(resp.Items)
				mu.Unlock()
				return nil
			case apierrors.IsForbidden(err):
				klog.V(2).Info("nodes snapshot: pod list forbidden; rendering node data without pod-derived metrics")
				mu.Lock()
				podsForbidden = true
				mu.Unlock()
				return nil
			default:
				return err
			}
		},
	}

	if err := parallel.RunLimited(ctx, 2, tasks...); err != nil {
		return nil, err
	}

	if podsForbidden {
		pods = nil
	}
	return buildNodeSnapshot(ctx, scope, nodes, pods, b.metrics)
}

// buildNodeSnapshot assembles node summaries with cluster metadata.
func buildNodeSnapshot(ctx context.Context, scope string, nodes []*corev1.Node, pods []*corev1.Pod, provider metrics.Provider) (*refresh.Snapshot, error) {
	var (
		nodeMetrics map[string]metrics.NodeUsage
		podMetrics  map[string]metrics.PodUsage
		metaSrc     metrics.Metadata
	)
	if provider != nil {
		nodeMetrics = provider.LatestNodeUsage()
		podMetrics = provider.LatestPodUsage()
		metaSrc = provider.Metadata()
	}
	return buildNodeSnapshotFromUsage(ctx, scope, nodes, pods, nodeUsageOrEmpty(nodeMetrics), podUsageOrEmpty(podMetrics), metaSrc)
}

// buildNodeSnapshotFromUsage assembles node summaries using pre-resolved
// metrics maps. This is the metrics-as-parameter path required by the
// resource-stream projection contract: stream handlers fetch the usage
// snapshot once and pass it in, so per-event row projection is
// deterministic and tests can use fixture metrics.
func buildNodeSnapshotFromUsage(
	ctx context.Context,
	scope string,
	nodes []*corev1.Node,
	pods []*corev1.Pod,
	nodeMetrics map[string]metrics.NodeUsage,
	podMetrics map[string]metrics.PodUsage,
	metricsMeta metrics.Metadata,
) (*refresh.Snapshot, error) {
	meta := ClusterMetaFromContext(ctx)
	clusterID, trimmed := refresh.SplitClusterScope(scope)
	_, query, err := parseTypedTableQueryScope(clusterID, strings.TrimSpace(trimmed), "nodes", "")
	if err != nil {
		// Every typed builder rejects a malformed query scope; silently serving
		// default-ordered rows under the requested identity is a contract hole.
		return nil, err
	}
	items := make([]NodeSummary, 0, len(nodes))
	var version uint64

	podsByNode := make(map[string][]*corev1.Pod)
	for _, pod := range pods {
		if pod == nil {
			continue
		}
		if pod.Spec.NodeName != "" {
			podsByNode[pod.Spec.NodeName] = append(podsByNode[pod.Spec.NodeName], pod)
		}
	}

	for _, node := range nodes {
		if node == nil {
			continue
		}
		model := nodepkg.BuildResourceModel(meta.ClusterID, node)
		nodeFacts := nodepkg.BuildFacts(node)
		ageTimestamp := int64(0)
		if !node.CreationTimestamp.Time.IsZero() {
			ageTimestamp = node.CreationTimestamp.Time.UnixMilli()
		}
		summary := NodeSummary{
			ClusterMeta:        meta,
			Name:               node.Name,
			Status:             model.Status.Label,
			StatusState:        model.Status.State,
			StatusPresentation: model.Status.Presentation,
			StatusReason:       model.Status.Reason,
			Roles:              formatRoles(extractRoles(node.Labels)),
			Age:                formatAge(node.CreationTimestamp.Time),
			AgeTimestamp:       ageTimestamp,
			Version:            node.Status.NodeInfo.KubeletVersion,
			Labels:             copyStringMap(node.Labels),
			Annotations:        copyStringMap(node.Annotations),
			Kind:               "node",
			Unschedulable:      nodeFacts.Unschedulable,
		}

		if ip := findNodeAddress(node, corev1.NodeInternalIP); ip != "" {
			summary.InternalIP = ip
		}
		if ip := findNodeAddress(node, corev1.NodeExternalIP); ip != "" {
			summary.ExternalIP = ip
		}

		cpuCapacity := node.Status.Capacity[corev1.ResourceCPU]
		cpuAlloc := node.Status.Allocatable[corev1.ResourceCPU]
		summary.CPUCapacity = cpuCapacity.String()
		summary.CPUAllocatable = cpuAlloc.String()
		summary.CPU = cpuCapacity.String()

		memCapacity := node.Status.Capacity[corev1.ResourceMemory]
		memAlloc := node.Status.Allocatable[corev1.ResourceMemory]
		summary.MemoryCapacity = formatMemoryBytes(memCapacity.Value())
		summary.MemoryAllocatable = formatMemoryBytes(memAlloc.Value())
		summary.Memory = formatMemoryBytes(memCapacity.Value())

		podsCapacity := node.Status.Capacity[corev1.ResourcePods]
		podsAlloc := node.Status.Allocatable[corev1.ResourcePods]
		summary.PodsCapacity = podsCapacity.String()
		summary.PodsAllocatable = podsAlloc.String()

		pods := podsByNode[node.Name]
		cpuReq, cpuLim, memReq, memLim, restarts := aggregatePodResources(pods)
		summary.CPURequests = formatCPUMilli(cpuReq)
		summary.CPULimits = formatCPUMilli(cpuLim)
		summary.MemRequests = formatMemoryBytes(memReq)
		summary.MemLimits = formatMemoryBytes(memLim)
		summary.Restarts = restarts

		if len(pods) > 0 {
			podSummaries := make([]NodePodMetric, 0, len(pods))
			for _, pod := range pods {
				if pod == nil {
					continue
				}
				key := fmt.Sprintf("%s/%s", pod.Namespace, pod.Name)
				usage := podMetrics[key]
				podSummaries = append(podSummaries, NodePodMetric{
					Namespace:   pod.Namespace,
					Name:        pod.Name,
					CPUUsage:    formatCPUMilli(usage.CPUUsageMilli),
					MemoryUsage: formatMemoryBytes(usage.MemoryUsageBytes),
				})
			}
			if len(podSummaries) > 0 {
				summary.PodMetrics = podSummaries
			}
		}
		if capacity := podsCapacity.Value(); capacity > 0 {
			summary.Pods = fmt.Sprintf("%d/%d", len(pods), capacity)
		} else {
			summary.Pods = fmt.Sprintf("%d", len(pods))
		}

		if usage, ok := nodeMetrics[node.Name]; ok {
			summary.CPUUsage = formatCPUMilli(usage.CPUUsageMilli)
			summary.MemoryUsage = formatMemoryBytes(usage.MemoryUsageBytes)
		} else {
			summary.CPUUsage = formatCPUMilli(0)
			summary.MemoryUsage = formatMemoryBytes(0)
		}

		summary.Taints = convertTaints(node.Spec.Taints)

		items = append(items, summary)
		if v := parseNodeResourceVersion(node); v > version {
			version = v
		}
	}

	metricsInfo := NodeMetricsInfo{Stale: true}
	dynamicRevision := ""
	if !metricsMeta.CollectedAt.IsZero() {
		dynamicRevision = strconv.FormatInt(metricsMeta.CollectedAt.UnixNano(), 10)
		metricsInfo.CollectedAt = metricsMeta.CollectedAt.Unix()
		metricsInfo.Stale = time.Since(metricsMeta.CollectedAt) > config.MetricsStaleThreshold
	}
	if metricsMeta.LastError != "" {
		metricsInfo.LastError = metricsMeta.LastError
	}
	if metricsMeta.ConsecutiveFailures > 0 {
		metricsInfo.ConsecutiveFailures = metricsMeta.ConsecutiveFailures
	}
	metricsInfo.SuccessCount = metricsMeta.SuccessCount
	metricsInfo.FailureCount = metricsMeta.FailureCount

	if query.Enabled {
		query.DynamicRevision = dynamicRevision
		page := applyTypedTableQuery(items, query, nodeTableQueryAdapter())
		return &refresh.Snapshot{
			Domain:  "nodes",
			Scope:   refresh.JoinClusterScope(clusterID, strings.TrimSpace(trimmed)),
			Version: snapshotVersionWithDynamicRevision(version, dynamicRevision),
			Payload: NodeSnapshot{
				ClusterMeta:           meta,
				ResourceQueryEnvelope: typedQueryEnvelope("nodes", page, nodeQueryCapabilities()),
				Rows:                  page.Rows,
				Metrics:               metricsInfo,
			},
			Stats: refresh.SnapshotStats{ItemCount: len(page.Rows)},
		}, nil
	}

	var totalItems int
	items, totalItems = truncateSnapshotWindow(items, config.SnapshotClusterNodesEntryLimit)

	snap := &refresh.Snapshot{
		Domain:  "nodes",
		Scope:   "",
		Version: snapshotVersionWithDynamicRevision(version, dynamicRevision),
		Payload: NodeSnapshot{
			ClusterMeta:           meta,
			ResourceQueryEnvelope: typedWindowEnvelope("nodes", totalItems, totalItems == len(items), snapshotSortedKinds(items, func(NodeSummary) string { return nodepkg.Identity.Kind }), nodeQueryCapabilities()),
			Rows:                  items,
			Metrics:               metricsInfo,
		},
		Stats: snapshotWindowStats(len(items), totalItems, "nodes"),
	}
	return snap, nil
}

func nodeUsageOrEmpty(m map[string]metrics.NodeUsage) map[string]metrics.NodeUsage {
	if m == nil {
		return map[string]metrics.NodeUsage{}
	}
	return m
}

func podUsageOrEmpty(m map[string]metrics.PodUsage) map[string]metrics.PodUsage {
	if m == nil {
		return map[string]metrics.PodUsage{}
	}
	return m
}

func extractRoles(labels map[string]string) []string {
	roles := []string{}
	for key := range labels {
		if key == "node-role.kubernetes.io/control-plane" {
			roles = append(roles, "control-plane")
		} else if key == "node-role.kubernetes.io/master" {
			roles = append(roles, "master")
		} else if key == "node-role.kubernetes.io/worker" {
			roles = append(roles, "worker")
		} else if prefix := "node-role.kubernetes.io/"; len(key) > len(prefix) && key[:len(prefix)] == prefix {
			roles = append(roles, key[len(prefix):])
		}
	}
	return roles
}

func parseNodeResourceVersion(node *corev1.Node) uint64 {
	if node == nil {
		return 0
	}
	if rv := node.ResourceVersion; rv != "" {
		if parsed, err := strconv.ParseUint(rv, 10, 64); err == nil {
			return parsed
		}
	}
	return uint64(node.CreationTimestamp.UnixNano())
}

func findNodeAddress(node *corev1.Node, addressType corev1.NodeAddressType) string {
	if node == nil {
		return ""
	}
	for _, addr := range node.Status.Addresses {
		if addr.Type == addressType {
			return addr.Address
		}
	}
	return ""
}

func copyStringMap(in map[string]string) map[string]string {
	if len(in) == 0 {
		return nil
	}
	out := make(map[string]string, len(in))
	for k, v := range in {
		out[k] = v
	}
	return out
}

func formatRoles(roles []string) string {
	if len(roles) == 0 {
		return "worker"
	}
	sort.Strings(roles)
	filtered := make([]string, 0, len(roles))
	var last string
	for i, role := range roles {
		if role == "" {
			continue
		}
		if i == 0 || role != last {
			filtered = append(filtered, role)
			last = role
		}
	}
	if len(filtered) == 0 {
		return "worker"
	}
	return strings.Join(filtered, ",")
}

func formatAge(t time.Time) string {
	return timeutil.FormatAge(t)
}

// formatCPUMilli/formatMemoryBytes live in the streamrows leaf so the metrics
// kind packages (pods/nodes/workloads) share them; these aliases keep the
// snapshot-side names for the remaining snapshot callers.
var formatCPUMilli = streamrows.FormatCPUMilli
var formatMemoryBytes = streamrows.FormatMemoryBytes

func aggregatePodResources(pods []*corev1.Pod) (cpuReq, cpuLim, memReq, memLim int64, restarts int32) {
	for _, pod := range pods {
		if pod == nil {
			continue
		}
		// Account for standard containers
		for _, container := range pod.Spec.Containers {
			if cpu := container.Resources.Requests.Cpu(); cpu != nil {
				cpuReq += cpu.MilliValue()
			}
			if cpu := container.Resources.Limits.Cpu(); cpu != nil {
				cpuLim += cpu.MilliValue()
			}
			if mem := container.Resources.Requests.Memory(); mem != nil {
				memReq += mem.Value()
			}
			if mem := container.Resources.Limits.Memory(); mem != nil {
				memLim += mem.Value()
			}
		}
		// Include init containers which may reserve resources
		for _, container := range pod.Spec.InitContainers {
			if cpu := container.Resources.Requests.Cpu(); cpu != nil {
				cpuReq += cpu.MilliValue()
			}
			if cpu := container.Resources.Limits.Cpu(); cpu != nil {
				cpuLim += cpu.MilliValue()
			}
			if mem := container.Resources.Requests.Memory(); mem != nil {
				memReq += mem.Value()
			}
			if mem := container.Resources.Limits.Memory(); mem != nil {
				memLim += mem.Value()
			}
		}
		for _, status := range pod.Status.ContainerStatuses {
			restarts += status.RestartCount
		}
		for _, status := range pod.Status.InitContainerStatuses {
			restarts += status.RestartCount
		}
	}
	return
}

func convertTaints(taints []corev1.Taint) []NodeTaint {
	if len(taints) == 0 {
		return nil
	}
	out := make([]NodeTaint, 0, len(taints))
	for _, taint := range taints {
		out = append(out, NodeTaint{
			Key:    taint.Key,
			Value:  taint.Value,
			Effect: string(taint.Effect),
		})
	}
	return out
}
