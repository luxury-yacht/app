package snapshot

import (
	"context"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/labels"
	informers "k8s.io/client-go/informers"
	appslisters "k8s.io/client-go/listers/apps/v1"
	corelisters "k8s.io/client-go/listers/core/v1"
	"k8s.io/client-go/tools/cache"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
	"github.com/luxury-yacht/app/backend/refresh/metrics"
)

// PodBuilder constructs pod snapshots scoped by node or workload.
type PodBuilder struct {
	podLister  corelisters.PodLister
	podIndexer cache.Indexer
	rsLister   appslisters.ReplicaSetLister
	metrics    metrics.Provider
}

// PodSnapshot is the payload for the pods domain.
type PodSnapshot struct {
	Pods    []PodSummary   `json:"pods"`
	Metrics PodMetricsInfo `json:"metrics"`
}

// PodSummary captures essential pod information for UI tables.
type PodSummary struct {
	Name       string `json:"name"`
	Namespace  string `json:"namespace"`
	Node       string `json:"node"`
	Status     string `json:"status"`
	Ready      string `json:"ready"`
	Restarts   int32  `json:"restarts"`
	Age        string `json:"age"`
	OwnerKind  string `json:"ownerKind"`
	OwnerName  string `json:"ownerName"`
	CPURequest string `json:"cpuRequest"`
	CPULimit   string `json:"cpuLimit"`
	CPUUsage   string `json:"cpuUsage"`
	MemRequest string `json:"memRequest"`
	MemLimit   string `json:"memLimit"`
	MemUsage   string `json:"memUsage"`
}

// PodMetricsInfo mirrors metrics poller metadata for pods.
type PodMetricsInfo struct {
	CollectedAt         int64  `json:"collectedAt,omitempty"`
	Stale               bool   `json:"stale"`
	LastError           string `json:"lastError,omitempty"`
	ConsecutiveFailures int    `json:"consecutiveFailures,omitempty"`
	SuccessCount        uint64 `json:"successCount"`
	FailureCount        uint64 `json:"failureCount"`
}

const (
	podDomainName     = "pods"
	workloadScopeKey  = "workload"
	nodeScopeKey      = "node"
	namespaceScopeKey = "namespace"
	podNodeIndexName  = "pods:node"
)

// RegisterPodDomain registers the pods snapshot domain.
func RegisterPodDomain(reg *domain.Registry, factory informers.SharedInformerFactory, provider metrics.Provider) error {
	podInformer := factory.Core().V1().Pods().Informer()
	builder := &PodBuilder{
		podLister:  factory.Core().V1().Pods().Lister(),
		podIndexer: podInformer.GetIndexer(),
		rsLister:   factory.Apps().V1().ReplicaSets().Lister(),
		metrics:    provider,
	}
	return reg.Register(refresh.DomainConfig{
		Name:          podDomainName,
		BuildSnapshot: builder.Build,
	})
}

// Build returns the pod snapshot for the requested scope.
func (b *PodBuilder) Build(ctx context.Context, scope string) (*refresh.Snapshot, error) {
	if strings.TrimSpace(scope) == "" {
		return nil, fmt.Errorf("pods scope is required")
	}

	pods, err := b.collectPods(scope)
	if err != nil {
		return nil, err
	}

	podUsage := map[string]metrics.PodUsage{}
	var metadata metrics.Metadata
	if b.metrics != nil {
		podUsage = b.metrics.LatestPodUsage()
		metadata = b.metrics.Metadata()
	}

	rsMap, err := b.replicasetDeploymentMap(pods)
	if err != nil {
		return nil, err
	}

	summaries := make([]PodSummary, 0, len(pods))
	var version uint64
	for _, pod := range pods {
		if pod == nil {
			continue
		}
		summary := buildPodSummary(pod, podUsage, rsMap)
		summaries = append(summaries, summary)
		if v := parsePodResourceVersion(pod); v > version {
			version = v
		}
	}

	sort.Slice(summaries, func(i, j int) bool {
		if summaries[i].Namespace == summaries[j].Namespace {
			return summaries[i].Name < summaries[j].Name
		}
		return summaries[i].Namespace < summaries[j].Namespace
	})

	metricsInfo := PodMetricsInfo{Stale: true}
	if !metadata.CollectedAt.IsZero() {
		metricsInfo.CollectedAt = metadata.CollectedAt.Unix()
		metricsInfo.Stale = time.Since(metadata.CollectedAt) > config.MetricsStaleThreshold
	} else {
		metricsInfo.Stale = true
	}
	metricsInfo.LastError = metadata.LastError
	metricsInfo.ConsecutiveFailures = metadata.ConsecutiveFailures
	metricsInfo.SuccessCount = metadata.SuccessCount
	metricsInfo.FailureCount = metadata.FailureCount

	snapshot := &refresh.Snapshot{
		Domain:  podDomainName,
		Scope:   scope,
		Version: version,
		Payload: PodSnapshot{Pods: summaries, Metrics: metricsInfo},
		Stats: refresh.SnapshotStats{
			ItemCount: len(summaries),
		},
	}

	return snapshot, nil
}

func (b *PodBuilder) collectPods(scope string) ([]*corev1.Pod, error) {
	parts := strings.SplitN(scope, ":", 2)
	if len(parts) != 2 {
		return nil, fmt.Errorf("invalid pods scope: %s", scope)
	}

	scopeKey := parts[0]
	value := parts[1]

	switch scopeKey {
	case nodeScopeKey:
		return b.listPodsByNode(value)
	case workloadScopeKey:
		parsed, err := parseWorkloadScope(value)
		if err != nil {
			return nil, err
		}
		pods, err := b.listPodsByNamespace(parsed.namespace)
		if err != nil {
			return nil, err
		}
		filtered := make([]*corev1.Pod, 0, len(pods))
		for _, pod := range pods {
			if matchesWorkload(pod, parsed, b.rsLister) {
				filtered = append(filtered, pod)
			}
		}
		return filtered, nil
	case namespaceScopeKey:
		namespace := strings.TrimSpace(value)
		if namespace == "" {
			return nil, fmt.Errorf("invalid namespace scope: %s", scope)
		}
		if namespace == "all" || namespace == "*" {
			return b.listAllPods()
		}
		return b.listPodsByNamespace(namespace)
	default:
		return nil, fmt.Errorf("unsupported pods scope: %s", scope)
	}
}

type workloadScope struct {
	namespace string
	kind      string
	name      string
}

func parseWorkloadScope(value string) (workloadScope, error) {
	parts := strings.Split(value, ":")
	if len(parts) != 3 {
		return workloadScope{}, fmt.Errorf("invalid workload scope: %s", value)
	}
	return workloadScope{
		namespace: parts[0],
		kind:      parts[1],
		name:      parts[2],
	}, nil
}

func matchesWorkload(pod *corev1.Pod, scope workloadScope, rsLister appslisters.ReplicaSetLister) bool {
	for _, owner := range pod.OwnerReferences {
		if owner.Controller == nil || !*owner.Controller {
			continue
		}
		if owner.Kind == scope.kind && owner.Name == scope.name {
			return true
		}
		if owner.Kind == "ReplicaSet" && scope.kind == "Deployment" && rsLister != nil {
			rs, err := rsLister.ReplicaSets(pod.Namespace).Get(owner.Name)
			if err != nil {
				continue
			}
			for _, rsOwner := range rs.OwnerReferences {
				if rsOwner.Controller != nil && *rsOwner.Controller && rsOwner.Kind == "Deployment" && rsOwner.Name == scope.name {
					return true
				}
			}
		}
	}
	return false
}

func (b *PodBuilder) replicasetDeploymentMap(pods []*corev1.Pod) (map[string]string, error) {
	if b.rsLister == nil {
		return nil, nil
	}
	result := make(map[string]string)
	for _, pod := range pods {
		if pod == nil {
			continue
		}
		for _, owner := range pod.OwnerReferences {
			if owner.Controller == nil || !*owner.Controller || owner.Kind != "ReplicaSet" {
				continue
			}
			if _, exists := result[owner.Name]; exists {
				continue
			}
			rs, err := b.rsLister.ReplicaSets(pod.Namespace).Get(owner.Name)
			if err != nil {
				if apierrors.IsNotFound(err) {
					continue
				}
				return nil, err
			}
			for _, rsOwner := range rs.OwnerReferences {
				if rsOwner.Controller != nil && *rsOwner.Controller && rsOwner.Kind == "Deployment" {
					result[owner.Name] = rsOwner.Name
					break
				}
			}
		}
	}
	return result, nil
}

func (b *PodBuilder) listPodsByNamespace(namespace string) ([]*corev1.Pod, error) {
	if b.podIndexer != nil {
		items, err := b.podIndexer.ByIndex(cache.NamespaceIndex, namespace)
		if err == nil {
			return convertPodIndexerItems(items), nil
		}
	}
	return b.podLister.Pods(namespace).List(labels.Everything())
}

func (b *PodBuilder) listAllPods() ([]*corev1.Pod, error) {
	return b.podLister.List(labels.Everything())
}

func (b *PodBuilder) listPodsByNode(node string) ([]*corev1.Pod, error) {
	if node == "" {
		return []*corev1.Pod{}, nil
	}
	if b.podIndexer != nil {
		items, err := b.podIndexer.ByIndex(podNodeIndexName, node)
		if err == nil {
			return convertPodIndexerItems(items), nil
		}
	}
	allPods, err := b.podLister.List(labels.Everything())
	if err != nil {
		return nil, err
	}
	result := make([]*corev1.Pod, 0)
	for _, pod := range allPods {
		if pod.Spec.NodeName == node {
			result = append(result, pod)
		}
	}
	return result, nil
}

func convertPodIndexerItems(items []interface{}) []*corev1.Pod {
	if len(items) == 0 {
		return []*corev1.Pod{}
	}
	result := make([]*corev1.Pod, 0, len(items))
	for _, item := range items {
		if pod, ok := item.(*corev1.Pod); ok && pod != nil {
			result = append(result, pod)
		}
	}
	return result
}

func buildPodSummary(pod *corev1.Pod, usage map[string]metrics.PodUsage, rsMap map[string]string) PodSummary {
	ready, total, restarts := podReadiness(pod)
	status := derivePodStatus(pod)
	ownerKind, ownerName := resolvePodOwner(pod, rsMap)
	cpuReq, cpuLim, memReq, memLim := computeResourceTotals(pod)
	metricKey := fmt.Sprintf("%s/%s", pod.Namespace, pod.Name)
	metricsUsage := usage[metricKey]

	return PodSummary{
		Name:       pod.Name,
		Namespace:  pod.Namespace,
		Node:       pod.Spec.NodeName,
		Status:     status,
		Ready:      fmt.Sprintf("%d/%d", ready, total),
		Restarts:   restarts,
		Age:        formatAge(pod.CreationTimestamp.Time),
		OwnerKind:  ownerKind,
		OwnerName:  ownerName,
		CPURequest: formatCPUMilli(cpuReq),
		CPULimit:   formatCPUMilli(cpuLim),
		CPUUsage:   formatCPUMilli(metricsUsage.CPUUsageMilli),
		MemRequest: formatMemoryBytes(memReq),
		MemLimit:   formatMemoryBytes(memLim),
		MemUsage:   formatMemoryBytes(metricsUsage.MemoryUsageBytes),
	}
}

func podReadiness(pod *corev1.Pod) (ready int32, total int32, restarts int32) {
	for _, cs := range pod.Status.ContainerStatuses {
		total++
		if cs.Ready {
			ready++
		}
		restarts += cs.RestartCount
	}
	return ready, total, restarts
}

func derivePodStatus(pod *corev1.Pod) string {
	status := string(pod.Status.Phase)
	for _, cs := range pod.Status.ContainerStatuses {
		if cs.State.Waiting != nil {
			reason := cs.State.Waiting.Reason
			if reason == "CrashLoopBackOff" || reason == "ImagePullBackOff" || reason == "ErrImagePull" {
				return reason
			}
		}
	}
	return status
}

func resolvePodOwner(pod *corev1.Pod, rsMap map[string]string) (string, string) {
	for _, owner := range pod.OwnerReferences {
		if owner.Controller == nil || !*owner.Controller {
			continue
		}
		kind := owner.Kind
		name := owner.Name
		if owner.Kind == "ReplicaSet" {
			if deployment, ok := rsMap[owner.Name]; ok {
				kind = "Deployment"
				name = deployment
			}
		}
		return kind, name
	}
	return "None", "None"
}

func parsePodResourceVersion(pod *corev1.Pod) uint64 {
	if pod == nil {
		return 0
	}
	if rv := pod.ResourceVersion; rv != "" {
		if parsed, err := strconv.ParseUint(rv, 10, 64); err == nil {
			return parsed
		}
	}
	return uint64(pod.CreationTimestamp.UnixNano())
}

func computeResourceTotals(pod *corev1.Pod) (cpuReq, cpuLim, memReq, memLim int64) {
	if pod == nil {
		return 0, 0, 0, 0
	}
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
	return cpuReq, cpuLim, memReq, memLim
}
