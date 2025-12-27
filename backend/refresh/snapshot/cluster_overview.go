package snapshot

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/labels"
	versioned "k8s.io/apimachinery/pkg/version"
	informers "k8s.io/client-go/informers"
	"k8s.io/client-go/kubernetes"
	corelisters "k8s.io/client-go/listers/core/v1"
	"k8s.io/client-go/tools/cache"
	"k8s.io/klog/v2"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/internal/parallel"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
	"github.com/luxury-yacht/app/backend/refresh/metrics"
)

const (
	clusterOverviewDomainName = "cluster-overview"
)

// ClusterOverviewBuilder constructs aggregated cluster statistics using informer caches.
type ClusterOverviewBuilder struct {
	client          kubernetes.Interface
	nodeLister      corelisters.NodeLister
	podLister       corelisters.PodLister
	namespaceLister corelisters.NamespaceLister
	metrics         metrics.Provider
	serverHost      string

	versionMu      sync.RWMutex
	cachedVersion  string
	versionFetched time.Time

	hasSyncedFns []cache.InformerSynced
	synced       atomic.Uint32
}

// ClusterOverviewSnapshot is the payload published for the cluster overview domain.
type ClusterOverviewSnapshot struct {
	ClusterMeta
	Overview ClusterOverviewPayload `json:"overview"`
	Metrics  ClusterOverviewMetrics `json:"metrics"`
}

// ClusterOverviewMetrics exposes poller metadata relevant to aggregated usage values.
type ClusterOverviewMetrics struct {
	CollectedAt         int64  `json:"collectedAt,omitempty"`
	Stale               bool   `json:"stale"`
	LastError           string `json:"lastError,omitempty"`
	ConsecutiveFailures int    `json:"consecutiveFailures,omitempty"`
	SuccessCount        uint64 `json:"successCount"`
	FailureCount        uint64 `json:"failureCount"`
}

// ClusterOverviewPayload mirrors the data needed by the frontend overview cards.
type ClusterOverviewPayload struct {
	ClusterType    string `json:"clusterType"`
	ClusterVersion string `json:"clusterVersion"`

	CPUUsage       string `json:"cpuUsage"`
	CPURequests    string `json:"cpuRequests"`
	CPULimits      string `json:"cpuLimits"`
	CPUAllocatable string `json:"cpuAllocatable"`

	MemoryUsage       string `json:"memoryUsage"`
	MemoryRequests    string `json:"memoryRequests"`
	MemoryLimits      string `json:"memoryLimits"`
	MemoryAllocatable string `json:"memoryAllocatable"`

	TotalNodes   int `json:"totalNodes"`
	FargateNodes int `json:"fargateNodes"`
	RegularNodes int `json:"regularNodes"`
	EC2Nodes     int `json:"ec2Nodes"`

	TotalPods           int `json:"totalPods"`
	TotalContainers     int `json:"totalContainers"`
	TotalInitContainers int `json:"totalInitContainers"`
	RunningPods         int `json:"runningPods"`
	PendingPods         int `json:"pendingPods"`
	FailedPods          int `json:"failedPods"`
	RestartedPods       int `json:"restartedPods"`

	TotalNamespaces int `json:"totalNamespaces"`
}

// RegisterClusterOverviewDomain wires the cluster-overview domain into the registry.
func RegisterClusterOverviewDomain(
	reg *domain.Registry,
	factory informers.SharedInformerFactory,
	client kubernetes.Interface,
	provider metrics.Provider,
	serverHost string,
) error {
	if reg == nil {
		return fmt.Errorf("cluster overview: registry is nil")
	}
	if factory == nil {
		return fmt.Errorf("cluster overview: shared informer factory is nil")
	}
	if client == nil {
		return fmt.Errorf("cluster overview: kubernetes client is nil")
	}

	nodeInformer := factory.Core().V1().Nodes()
	podInformer := factory.Core().V1().Pods()
	namespaceInformer := factory.Core().V1().Namespaces()

	builder := &ClusterOverviewBuilder{
		client:          client,
		nodeLister:      nodeInformer.Lister(),
		podLister:       podInformer.Lister(),
		namespaceLister: namespaceInformer.Lister(),
		metrics:         provider,
		serverHost:      serverHost,
		hasSyncedFns: []cache.InformerSynced{
			nodeInformer.Informer().HasSynced,
			podInformer.Informer().HasSynced,
			namespaceInformer.Informer().HasSynced,
		},
	}

	return reg.Register(refresh.DomainConfig{
		Name:          clusterOverviewDomainName,
		BuildSnapshot: builder.Build,
	})
}

type ClusterOverviewListBuilder struct {
	client     kubernetes.Interface
	metrics    metrics.Provider
	versionFn  func(context.Context) string
	serverHost string
}

// RegisterClusterOverviewDomainList registers a list-based fallback builder when informers are unavailable.
func RegisterClusterOverviewDomainList(reg *domain.Registry, client kubernetes.Interface, provider metrics.Provider, serverHost string) error {
	if reg == nil {
		return fmt.Errorf("cluster overview: registry is nil")
	}
	if client == nil {
		return fmt.Errorf("cluster overview: kubernetes client is nil")
	}

	delegate := &ClusterOverviewBuilder{client: client, metrics: provider, serverHost: serverHost}
	builder := &ClusterOverviewListBuilder{
		client:     client,
		metrics:    provider,
		versionFn:  delegate.serverVersion,
		serverHost: serverHost,
	}

	return reg.Register(refresh.DomainConfig{
		Name:          clusterOverviewDomainName,
		BuildSnapshot: builder.Build,
	})
}

func (b *ClusterOverviewListBuilder) Build(ctx context.Context, scope string) (*refresh.Snapshot, error) {
	var (
		nodes            []*corev1.Node
		pods             []*corev1.Pod
		namespaces       []*corev1.Namespace
		podsForbidden    bool
		namespacesDenied bool
		mu               sync.Mutex
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
				klog.V(2).Info("cluster-overview fallback: pod list forbidden; proceeding without pod metrics")
				mu.Lock()
				podsForbidden = true
				mu.Unlock()
				return nil
			default:
				return err
			}
		},
		func(ctx context.Context) error {
			resp, err := b.client.CoreV1().Namespaces().List(ctx, metav1.ListOptions{})
			switch {
			case err == nil:
				mu.Lock()
				namespaces = parallel.CopyToPointers(resp.Items)
				mu.Unlock()
				return nil
			case apierrors.IsForbidden(err):
				klog.V(2).Info("cluster-overview fallback: namespace list forbidden; proceeding with empty namespace set")
				mu.Lock()
				namespacesDenied = true
				mu.Unlock()
				return nil
			default:
				return err
			}
		},
	}

	if err := parallel.RunLimited(ctx, 3, tasks...); err != nil {
		return nil, err
	}
	if podsForbidden {
		pods = nil
	}
	if namespacesDenied {
		namespaces = nil
	}

	versionFn := b.versionFn
	if versionFn == nil {
		versionFn = func(context.Context) string { return defaultClusterVersion("") }
	}

	return buildClusterOverviewSnapshot(ctx, nodes, pods, namespaces, b.metrics, versionFn, b.serverHost)
}

// Build assembles the cluster overview payload from cached resources and metrics.
func (b *ClusterOverviewBuilder) Build(ctx context.Context, scope string) (*refresh.Snapshot, error) {
	return b.buildFromListers(ctx)
}

func buildClusterOverviewSnapshot(
	ctx context.Context,
	nodes []*corev1.Node,
	pods []*corev1.Pod,
	namespaces []*corev1.Namespace,
	provider metrics.Provider,
	versionFn func(context.Context) string,
	serverHost string,
) (*refresh.Snapshot, error) {
	meta := CurrentClusterMeta()
	overview := ClusterOverviewPayload{}
	var version uint64

	var cpuAllocatableMilli int64
	var cpuRequestsMilli int64
	var cpuLimitsMilli int64
	var cpuUsageMilli int64

	var memAllocatableBytes int64
	var memRequestsBytes int64
	var memLimitsBytes int64
	var memUsageBytes int64

	nonFargateNodes := 0

	for _, node := range nodes {
		if node == nil {
			continue
		}
		overview.TotalNodes++
		if v := resourceVersionOrTimestamp(node); v > version {
			version = v
		}

		cpuAllocatableMilli += node.Status.Allocatable.Cpu().MilliValue()
		memAllocatableBytes += node.Status.Allocatable.Memory().Value()

		if _, ok := node.Labels["eks.amazonaws.com/compute-type"]; ok {
			overview.FargateNodes++
			continue
		}
		nonFargateNodes++
	}

	metricsSnapshot := ClusterOverviewMetrics{Stale: true}
	if provider != nil {
		usage := provider.LatestPodUsage()
		for _, entry := range usage {
			cpuUsageMilli += entry.CPUUsageMilli
			memUsageBytes += entry.MemoryUsageBytes
		}
		meta := provider.Metadata()
		lastError := meta.LastError

		// Grace period: avoid surfacing a metrics error before any successful poll has completed.
		if meta.SuccessCount == 0 && meta.CollectedAt.IsZero() && meta.ConsecutiveFailures < 5 {
			lastError = ""
		}

		stale := false
		if !meta.CollectedAt.IsZero() && time.Since(meta.CollectedAt) > config.MetricsStaleWindow {
			stale = true
		}

		metricsSnapshot = ClusterOverviewMetrics{
			CollectedAt:         meta.CollectedAt.Unix(),
			Stale:               stale,
			LastError:           lastError,
			ConsecutiveFailures: meta.ConsecutiveFailures,
			SuccessCount:        meta.SuccessCount,
			FailureCount:        meta.FailureCount,
		}
	}

	for _, pod := range pods {
		if pod == nil {
			continue
		}
		overview.TotalPods++
		if v := resourceVersionOrTimestamp(pod); v > version {
			version = v
		}

		switch pod.Status.Phase {
		case corev1.PodRunning:
			overview.RunningPods++
		case corev1.PodPending:
			overview.PendingPods++
		case corev1.PodFailed:
			overview.FailedPods++
		}

		overview.TotalContainers += len(pod.Spec.Containers)
		overview.TotalInitContainers += len(pod.Spec.InitContainers)

		hasRestarts := false
		for _, status := range pod.Status.ContainerStatuses {
			if status.RestartCount > 0 {
				hasRestarts = true
				break
			}
		}
		if !hasRestarts {
			for _, status := range pod.Status.InitContainerStatuses {
				if status.RestartCount > 0 {
					hasRestarts = true
					break
				}
			}
		}

		for _, container := range pod.Spec.Containers {
			if cpu := container.Resources.Requests.Cpu(); cpu != nil {
				cpuRequestsMilli += cpu.MilliValue()
			}
			if cpu := container.Resources.Limits.Cpu(); cpu != nil {
				cpuLimitsMilli += cpu.MilliValue()
			}
			if mem := container.Resources.Requests.Memory(); mem != nil {
				memRequestsBytes += mem.Value()
			}
			if mem := container.Resources.Limits.Memory(); mem != nil {
				memLimitsBytes += mem.Value()
			}
		}
		for _, container := range pod.Spec.InitContainers {
			if cpu := container.Resources.Requests.Cpu(); cpu != nil {
				cpuRequestsMilli += cpu.MilliValue()
			}
			if cpu := container.Resources.Limits.Cpu(); cpu != nil {
				cpuLimitsMilli += cpu.MilliValue()
			}
			if mem := container.Resources.Requests.Memory(); mem != nil {
				memRequestsBytes += mem.Value()
			}
			if mem := container.Resources.Limits.Memory(); mem != nil {
				memLimitsBytes += mem.Value()
			}
		}

		if hasRestarts {
			overview.RestartedPods++
		}
	}

	for _, ns := range namespaces {
		if ns == nil {
			continue
		}
		overview.TotalNamespaces++
		if v := resourceVersionOrTimestamp(ns); v > version {
			version = v
		}
	}

	overview.CPUUsage = formatCPUValue(cpuUsageMilli)
	overview.CPURequests = formatCPUValue(cpuRequestsMilli)
	overview.CPULimits = formatCPUValue(cpuLimitsMilli)
	overview.CPUAllocatable = formatCPUValue(cpuAllocatableMilli)

	overview.MemoryUsage = formatMemoryValue(memUsageBytes)
	overview.MemoryRequests = formatMemoryValue(memRequestsBytes)
	overview.MemoryLimits = formatMemoryValue(memLimitsBytes)
	overview.MemoryAllocatable = formatMemoryValue(memAllocatableBytes)

	if versionFn != nil {
		overview.ClusterVersion = versionFn(ctx)
	}
	overview.ClusterVersion = defaultClusterVersion(overview.ClusterVersion)

	clusterType := detectClusterType(overview.ClusterVersion, serverHost)
	overview.ClusterType = clusterType
	if clusterType == "EKS" {
		overview.EC2Nodes = nonFargateNodes
	} else {
		overview.RegularNodes = nonFargateNodes
	}

	return &refresh.Snapshot{
		Domain:  clusterOverviewDomainName,
		Scope:   "",
		Version: version,
		Payload: ClusterOverviewSnapshot{
			ClusterMeta: meta,
			Overview: overview,
			Metrics:  metricsSnapshot,
		},
		Stats: refresh.SnapshotStats{
			ItemCount: overview.TotalNodes,
		},
	}, nil
}

func (b *ClusterOverviewBuilder) waitForInformerSync(ctx context.Context) error {
	if len(b.hasSyncedFns) == 0 {
		return nil
	}
	if b.synced.Load() == 1 {
		return nil
	}
	ticker := time.NewTicker(config.RefreshInformerSyncPollInterval)
	defer ticker.Stop()

	for {
		allSynced := true
		for _, fn := range b.hasSyncedFns {
			if fn == nil {
				continue
			}
			if !fn() {
				allSynced = false
				break
			}
		}
		if allSynced {
			b.synced.Store(1)
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
		}
	}
}

func (b *ClusterOverviewBuilder) serverVersion(_ context.Context) string {
	b.versionMu.RLock()
	cached := b.cachedVersion
	last := b.versionFetched
	b.versionMu.RUnlock()

	if cached != "" && time.Since(last) < config.ClusterVersionCacheTTL {
		return cached
	}

	b.versionMu.Lock()
	defer b.versionMu.Unlock()

	if b.cachedVersion != "" && time.Since(b.versionFetched) < config.ClusterVersionCacheTTL {
		return b.cachedVersion
	}

	if b.client == nil {
		return defaultClusterVersion(b.cachedVersion)
	}
	var info *versioned.Info
	var err error
	if discovery := b.client.Discovery(); discovery != nil {
		info, err = discovery.ServerVersion()
	}
	if err != nil || info == nil {
		return defaultClusterVersion(b.cachedVersion)
	}
	b.cachedVersion = info.GitVersion
	b.versionFetched = time.Now()
	return b.cachedVersion
}

func defaultClusterVersion(existing string) string {
	if existing != "" {
		return existing
	}
	return "Unknown"
}

func detectClusterType(version string, serverHost string) string {
	normalized := strings.ToLower(strings.TrimSpace(version))
	if normalized != "" && normalized != "unknown" {
		switch {
		case strings.Contains(normalized, "eks"):
			return "EKS"
		case strings.Contains(normalized, "gke"):
			return "GKE"
		case strings.Contains(normalized, "azmk8s"):
			return "AKS"
		case strings.Contains(normalized, "openshift"):
			return "OpenShift"
		}
	}

	return detectClusterTypeFromServer(serverHost)
}

func detectClusterTypeFromServer(serverHost string) string {
	normalized := strings.ToLower(strings.TrimSpace(serverHost))
	switch {
	case normalized == "":
		return "Unmanaged"
	case strings.Contains(normalized, "azmk8s.io"):
		return "AKS"
	case strings.Contains(normalized, "eks.amazon.com"):
		return "EKS"
	default:
		return "Unmanaged"
	}
}

func formatCPUValue(millicores int64) string {
	if millicores == 0 {
		return "0"
	}
	if millicores < 1000 {
		return fmt.Sprintf("%dm", millicores)
	}
	cores := float64(millicores) / 1000.0
	if cores == float64(int64(cores)) {
		return fmt.Sprintf("%.0f", cores)
	}
	return fmt.Sprintf("%.2f", cores)
}

func formatMemoryValue(bytes int64) string {
	if bytes == 0 {
		return "0"
	}
	const (
		ki = 1024
		mi = ki * 1024
		gi = mi * 1024
		ti = gi * 1024
	)
	if bytes < ki {
		return fmt.Sprintf("%d", bytes)
	}
	if bytes < mi {
		return fmt.Sprintf("%.1fKi", float64(bytes)/float64(ki))
	}
	if bytes < gi {
		return fmt.Sprintf("%.1fMi", float64(bytes)/float64(mi))
	}
	if bytes < ti {
		return fmt.Sprintf("%.1fGi", float64(bytes)/float64(gi))
	}
	return fmt.Sprintf("%.1fTi", float64(bytes)/float64(ti))
}
func (b *ClusterOverviewBuilder) buildFromListers(ctx context.Context) (*refresh.Snapshot, error) {
	if err := b.waitForInformerSync(ctx); err != nil {
		return nil, err
	}

	type listResult[T any] struct {
		items []*T
		err   error
	}

	var (
		nodeRes      listResult[corev1.Node]
		podRes       listResult[corev1.Pod]
		namespaceRes listResult[corev1.Namespace]
	)

	tasks := []func(context.Context) error{
		func(context.Context) error {
			list, err := b.nodeLister.List(labels.Everything())
			nodeRes.items = list
			nodeRes.err = err
			return err
		},
		func(context.Context) error {
			list, err := b.podLister.List(labels.Everything())
			podRes.items = list
			podRes.err = err
			return err
		},
		func(context.Context) error {
			list, err := b.namespaceLister.List(labels.Everything())
			namespaceRes.items = list
			namespaceRes.err = err
			return err
		},
	}

	if err := parallel.RunLimited(ctx, 3, tasks...); err != nil {
		return nil, err
	}
	if nodeRes.err != nil {
		return nil, nodeRes.err
	}
	if podRes.err != nil {
		return nil, podRes.err
	}
	if namespaceRes.err != nil {
		return nil, namespaceRes.err
	}

	return buildClusterOverviewSnapshot(ctx, nodeRes.items, podRes.items, namespaceRes.items, b.metrics, b.serverVersion, b.serverHost)
}
