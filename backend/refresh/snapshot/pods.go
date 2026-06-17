package snapshot

import (
	"context"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
	"time"

	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/labels"
	"k8s.io/apimachinery/pkg/runtime/schema"
	informers "k8s.io/client-go/informers"
	appslisters "k8s.io/client-go/listers/apps/v1"
	corelisters "k8s.io/client-go/listers/core/v1"
	"k8s.io/client-go/tools/cache"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
	"github.com/luxury-yacht/app/backend/refresh/metrics"
	"github.com/luxury-yacht/app/backend/refresh/streamrows"
	"github.com/luxury-yacht/app/backend/resources/common"
	podres "github.com/luxury-yacht/app/backend/resources/pods"
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
	ClusterMeta
	ResourceQueryEnvelope
	Rows    []PodSummary   `json:"rows"`
	Metrics PodMetricsInfo `json:"metrics"`
}

func podQueryCapabilities() ResourceQueryCapabilities {
	return newTypedResourceCapabilities(
		[]string{"name", "namespace", "status", "ready", "restarts", "owner", "node", "cpu", "memory", "age"},
		[]string{"kinds", "namespaces", "statuses", "nodes"},
		[]string{"name", "namespace", "status", "ready", "owner", "node"},
		[]string{podres.Identity.Kind},
	)
}

// PodSummary lives in the streamrows leaf so the pods package can build it; this
// alias keeps the snapshot-side name and wire JSON unchanged.
type PodSummary = streamrows.PodSummary

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
	meta := ClusterMetaFromContext(ctx)
	clusterID, trimmed := refresh.SplitClusterScope(scope)
	trimmed = strings.TrimSpace(trimmed)
	if trimmed == "" {
		return nil, fmt.Errorf("pods scope is required")
	}

	podUsage := map[string]metrics.PodUsage{}
	var metadata metrics.Metadata
	if b.metrics != nil {
		podUsage = b.metrics.LatestPodUsage()
		metadata = b.metrics.Metadata()
	}
	dynamicRevision := ""
	if !metadata.CollectedAt.IsZero() {
		dynamicRevision = strconv.FormatInt(metadata.CollectedAt.UnixNano(), 10)
	}
	baseScope, query, err := parseTypedTableQueryScope(clusterID, trimmed, podDomainName, dynamicRevision)
	if err != nil {
		return nil, err
	}

	pods, err := b.collectPods(baseScope)
	if err != nil {
		return nil, err
	}

	rsMap, err := b.replicasetDeploymentMap(pods)
	if err != nil {
		return nil, err
	}

	var version uint64
	var page typedTableQueryPage[PodSummary]
	if query.Enabled {
		collector := newTypedTableQueryCollector(query, podTableQueryAdapter())
		for _, pod := range pods {
			if pod == nil {
				continue
			}
			podMetricsUsage := podUsage[pod.Namespace+"/"+pod.Name]
			summary := podres.BuildStreamSummaryFromRSMap(meta, pod, podMetricsUsage.CPUUsageMilli, podMetricsUsage.MemoryUsageBytes, rsMap)
			collector.Add(summary)
			if v := parsePodResourceVersion(pod); v > version {
				version = v
			}
		}
		page = collector.Page()
	} else {
		summaries := make([]PodSummary, 0, len(pods))
		for _, pod := range pods {
			if pod == nil {
				continue
			}
			podMetricsUsage := podUsage[pod.Namespace+"/"+pod.Name]
			summary := podres.BuildStreamSummaryFromRSMap(meta, pod, podMetricsUsage.CPUUsageMilli, podMetricsUsage.MemoryUsageBytes, rsMap)
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
		page = applyTypedTableQuery(summaries, query, podTableQueryAdapter())
	}

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
		Scope:   refresh.JoinClusterScope(clusterID, trimmed),
		Version: snapshotVersionWithDynamicRevision(version, dynamicRevision),
		Payload: PodSnapshot{
			ClusterMeta:           meta,
			ResourceQueryEnvelope: typedQueryEnvelope(podDomainName, page, podQueryCapabilities()),
			Rows:                  page.Rows,
			Metrics:               metricsInfo,
		},
		Stats: refresh.SnapshotStats{
			ItemCount: len(page.Rows),
		},
	}

	return snapshot, nil
}

func podTableQueryAdapter() typedTableQueryAdapter[PodSummary] {
	return typedTableQueryAdapter[PodSummary]{
		Key: func(pod PodSummary) string {
			return fmt.Sprintf("%s/%s", strings.ToLower(pod.Namespace), strings.ToLower(pod.Name))
		},
		Namespace: func(pod PodSummary) string { return pod.Namespace },
		Kind:      func(PodSummary) string { return "Pod" },
		SearchText: func(pod PodSummary) []string {
			return []string{
				pod.Name,
				pod.Namespace,
				pod.Status,
				pod.Ready,
				pod.OwnerKind,
				pod.OwnerName,
				pod.Node,
			}
		},
		Predicate: func(pod PodSummary, field, value string) bool {
			switch strings.ToLower(strings.TrimSpace(field)) {
			case "health":
				switch strings.ToLower(strings.TrimSpace(value)) {
				case "restarts":
					return pod.Restarts > 0
				case "not-ready":
					ready, total, ok := parseReadyPair(pod.Ready)
					status := strings.ToLower(strings.TrimSpace(pod.Status))
					return ok && total > 0 && ready < total && status != "completed"
				case "unhealthy":
					presentation := strings.ToLower(strings.TrimSpace(pod.StatusPresentation))
					return presentation == "warning" || presentation == "error" || presentation == "not-ready" || presentation == "terminating"
				default:
					return true
				}
			default:
				return true
			}
		},
		SortValue: func(pod PodSummary, field string) string {
			switch strings.ToLower(field) {
			case "namespace":
				return pod.Namespace
			case "status":
				return pod.Status
			case "ready":
				return pod.Ready
			case "restarts":
				return strconv.Itoa(int(pod.Restarts))
			case "owner":
				return pod.OwnerName
			case "node":
				return pod.Node
			case "cpu":
				return pod.CPUUsage
			case "memory":
				return pod.MemUsage
			case "age":
				return pod.Age
			default:
				return pod.Name
			}
		},
		NumericSort: func(pod PodSummary, field string) (float64, bool) {
			switch strings.ToLower(field) {
			case "cpu":
				return parseFormattedCPUToMilli(pod.CPUUsage)
			case "memory":
				return parseFormattedMemoryToBytes(pod.MemUsage)
			case "restarts":
				return float64(pod.Restarts), true
			case "ready":
				ready, total, ok := parseReadyPair(pod.Ready)
				if !ok {
					// Keep "ready" uniformly numeric so the page sort and keyset
					// cursor agree; an unparseable pair sorts first ascending.
					return math.Inf(-1), true
				}
				return float64(ready*1000000 + total), true
			case "age":
				return numericAgeSortValue(pod.AgeTimestamp)
			default:
				return 0, false
			}
		},
	}
}

func parseReadyPair(value string) (int, int, bool) {
	parts := strings.Split(strings.TrimSpace(value), "/")
	if len(parts) != 2 {
		return 0, 0, false
	}
	ready, readyErr := strconv.Atoi(strings.TrimSpace(parts[0]))
	total, totalErr := strconv.Atoi(strings.TrimSpace(parts[1]))
	if readyErr != nil || totalErr != nil {
		return 0, 0, false
	}
	return ready, total, true
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
	namespace  string
	apiGroup   string
	apiVersion string
	kind       string
	name       string
}

func parseWorkloadScope(value string) (workloadScope, error) {
	parts := strings.Split(value, ":")
	if len(parts) != 5 {
		return workloadScope{}, fmt.Errorf("invalid workload scope: %s", value)
	}
	return workloadScope{
		namespace:  parts[0],
		apiGroup:   parts[1],
		apiVersion: parts[2],
		kind:       parts[3],
		name:       parts[4],
	}, nil
}

func matchesWorkload(pod *corev1.Pod, scope workloadScope, rsLister appslisters.ReplicaSetLister) bool {
	for _, owner := range pod.OwnerReferences {
		if owner.Controller == nil || !*owner.Controller {
			continue
		}
		if ownerMatchesWorkloadScope(owner.APIVersion, owner.Kind, owner.Name, scope) {
			return true
		}
		if owner.Kind == "ReplicaSet" && scope.kind == "Deployment" && rsLister != nil {
			rs, err := rsLister.ReplicaSets(pod.Namespace).Get(owner.Name)
			if err != nil {
				continue
			}
			for _, rsOwner := range rs.OwnerReferences {
				if rsOwner.Controller != nil && *rsOwner.Controller && ownerMatchesWorkloadScope(rsOwner.APIVersion, rsOwner.Kind, rsOwner.Name, scope) {
					return true
				}
			}
		}
	}
	return false
}

func ownerMatchesWorkloadScope(apiVersion, kind, name string, scope workloadScope) bool {
	gv, err := schema.ParseGroupVersion(apiVersion)
	if err != nil {
		return false
	}
	return gv.Group == scope.apiGroup &&
		gv.Version == scope.apiVersion &&
		kind == scope.kind &&
		name == scope.name
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

func hasForwardablePodPorts(pod *corev1.Pod) bool {
	if pod == nil {
		return false
	}
	return common.HasForwardableContainerPorts(pod.Spec.Containers)
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
