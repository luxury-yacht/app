package snapshot

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	daemonsetpkg "github.com/luxury-yacht/app/backend/resources/daemonset"
	deploymentpkg "github.com/luxury-yacht/app/backend/resources/deployment"
	jobpkg "github.com/luxury-yacht/app/backend/resources/job"
	statefulsetpkg "github.com/luxury-yacht/app/backend/resources/statefulset"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/labels"
	"k8s.io/apimachinery/pkg/runtime/schema"
	versioned "k8s.io/apimachinery/pkg/version"
	informers "k8s.io/client-go/informers"
	"k8s.io/client-go/kubernetes"
	appslisters "k8s.io/client-go/listers/apps/v1"
	corelisters "k8s.io/client-go/listers/core/v1"
	"k8s.io/client-go/tools/cache"
	"k8s.io/klog/v2"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/internal/parallel"
	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
	"github.com/luxury-yacht/app/backend/refresh/metrics"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	eventres "github.com/luxury-yacht/app/backend/resources/events"
)

const (
	clusterOverviewDomainName = "cluster-overview"
)

// clusterOverviewIngestSource supplies the cut pod kind's aggregation rows (for the
// per-pod overview math) AND the cut workload kinds' projected catalog rows (for the
// Deployment/StatefulSet/DaemonSet/CronJob counts). *ingest.IngestManager satisfies it.
type clusterOverviewIngestSource interface {
	AggregateRows(gvr schema.GroupVersionResource) []interface{}
	StoreResourceVersion(gvr schema.GroupVersionResource) string
	CatalogRows(gvr schema.GroupVersionResource) []interface{}
	HasSyncedFor(gvr schema.GroupVersionResource) bool
	// Rows returns the whole per-object bundle for a GVR in one consistent store read; the
	// overview reads the node store's Aggregate halves (nodeOverviewFact) through it.
	Rows(gvr schema.GroupVersionResource) []interface{}
}

// ClusterOverviewBuilder constructs aggregated cluster statistics using informer caches.
// Pods, nodes, and the four counted workload kinds (Deployment/StatefulSet/DaemonSet/CronJob)
// are cut to the ingest path: the per-pod aggregation reads the projected PodAggregate rows,
// the node summary reads projected node facts, and the workload counts read projected catalog
// rows from the ingest source, so none of those informers is instantiated. Required ingest
// stores and the namespace informer gate this domain's build.
type ClusterOverviewBuilder struct {
	client          kubernetes.Interface
	ingest          clusterOverviewIngestSource
	namespaceLister corelisters.NamespaceLister
	eventLister     corelisters.EventLister
	metrics         metrics.Provider
	serverHost      string

	versionMu      sync.RWMutex
	cachedVersion  string
	versionFetched time.Time

	hasSyncedFns   []cache.InformerSynced
	eventHasSynced cache.InformerSynced
	synced         atomic.Uint32

	requiredIngestGVRs []schema.GroupVersionResource
}

// workloadIngestCount returns the number of projected catalog rows in the cut workload
// kind's ingest store, or 0 when the store has not synced yet (the ingest equivalent of the
// prior informerSynced gate) or no ingest source is wired (a unit test / list fallback).
func (b *ClusterOverviewBuilder) workloadIngestCount(gvr schema.GroupVersionResource) int {
	if b.ingest == nil || !b.ingest.HasSyncedFor(gvr) {
		return 0
	}
	return len(b.ingest.CatalogRows(gvr))
}

// ClusterOverviewSnapshot is the payload published for the cluster overview domain.
type ClusterOverviewSnapshot struct {
	ClusterMeta
	Overview         ClusterOverviewPayload            `json:"overview"`
	Metrics          ClusterOverviewMetrics            `json:"metrics"`
	MetricsByCluster map[string]ClusterOverviewMetrics `json:"metricsByCluster,omitempty"`
	// OverviewByCluster keeps per-cluster cards for multi-cluster snapshots.
	OverviewByCluster map[string]ClusterOverviewPayload `json:"overviewByCluster,omitempty"`
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

	TotalNodes    int `json:"totalNodes"`
	FargateNodes  int `json:"fargateNodes"`
	RegularNodes  int `json:"regularNodes"`
	EC2Nodes      int `json:"ec2Nodes"`
	VirtualNodes  int `json:"virtualNodes"`
	VMNodes       int `json:"vmNodes"`
	ReadyNodes    int `json:"readyNodes"`
	NotReadyNodes int `json:"notReadyNodes"`
	CordonedNodes int `json:"cordonedNodes"`

	TotalPods           int `json:"totalPods"`
	TotalContainers     int `json:"totalContainers"`
	TotalInitContainers int `json:"totalInitContainers"`
	RunningPods         int `json:"runningPods"`
	SucceededPods       int `json:"succeededPods"`
	PendingPods         int `json:"pendingPods"`
	FailedPods          int `json:"failedPods"`
	ReadyPods           int `json:"readyPods"`
	StartingPods        int `json:"startingPods"`
	FailingPods         int `json:"failingPods"`
	TerminatingPods     int `json:"terminatingPods"`
	RestartedPods       int `json:"restartedPods"`
	NotReadyPods        int `json:"notReadyPods"`

	TotalNamespaces int `json:"totalNamespaces"`

	TotalDeployments  int `json:"totalDeployments"`
	TotalStatefulSets int `json:"totalStatefulSets"`
	TotalDaemonSets   int `json:"totalDaemonSets"`
	TotalCronJobs     int `json:"totalCronJobs"`

	WorkloadResourceUsage WorkloadResourceUsage `json:"workloadResourceUsage"`

	RecentEvents []RecentEvent `json:"recentEvents"`
}

type WorkloadResourceUsage struct {
	Deployments  WorkloadTypeResourceUsage `json:"deployments"`
	DaemonSets   WorkloadTypeResourceUsage `json:"daemonSets"`
	StatefulSets WorkloadTypeResourceUsage `json:"statefulSets"`
	Jobs         WorkloadTypeResourceUsage `json:"jobs"`
}

type WorkloadTypeResourceUsage struct {
	CPUUsage    string `json:"cpuUsage"`
	MemoryUsage string `json:"memoryUsage"`
}

// RecentEvent is a single warning event shown on the cluster overview.
// Only the fields needed to render the row and navigate to the involved
// object are included; richer event detail lives in the Events views.
type RecentEvent struct {
	ClusterID        string                      `json:"clusterId,omitempty"`
	ClusterName      string                      `json:"clusterName,omitempty"`
	InvolvedObject   *resourcemodel.ResourceLink `json:"involvedObject,omitempty"`
	EventUID         string                      `json:"eventUid"`
	Reason           string                      `json:"reason"`
	Message          string                      `json:"message"`
	Timestamp        int64                       `json:"timestamp"`
	ObjectKind       string                      `json:"objectKind"`
	ObjectName       string                      `json:"objectName"`
	ObjectNamespace  string                      `json:"objectNamespace"`
	ObjectAPIVersion string                      `json:"objectApiVersion"`
	ObjectUID        string                      `json:"objectUid"`
}

// RegisterClusterOverviewDomain wires the cluster-overview domain into the registry.
// Pods is cut to the ingest path: the per-pod aggregation reads the projected
// PodAggregate rows from the ingest manager instead of a typed pod lister, so the pod
// informer is never instantiated. ingestManager may be nil in a unit test, in which
// case no pods are aggregated.
func RegisterClusterOverviewDomain(
	reg *domain.Registry,
	factory informers.SharedInformerFactory,
	client kubernetes.Interface,
	provider metrics.Provider,
	serverHost string,
	ingestManager clusterOverviewIngestSource,
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

	namespaceInformer := factory.Core().V1().Namespaces()
	eventInformer := factory.Core().V1().Events()

	builder := &ClusterOverviewBuilder{
		client:          client,
		ingest:          ingestManager,
		namespaceLister: namespaceInformer.Lister(),
		eventLister:     eventInformer.Lister(),
		metrics:         provider,
		serverHost:      serverHost,
		// Pod readiness, the node overview facts, and the workload counts are gated by the
		// ingest stores' HasSynced (read per-build via HasSyncedFor / workloadIngestCount /
		// the pod aggregate read), not an informer HasSynced here — those informers no longer
		// exist. Only the namespace cache still gates this domain's build via an informer.
		hasSyncedFns: []cache.InformerSynced{
			namespaceInformer.Informer().HasSynced,
		},
		eventHasSynced:     eventInformer.Informer().HasSynced,
		requiredIngestGVRs: []schema.GroupVersionResource{PodGVR, NodeGVR},
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
		replicaSets      []*appsv1.ReplicaSet
		recentEvents     []RecentEvent
		deploymentCount  int
		statefulSetCount int
		daemonSetCount   int
		cronJobCount     int
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
		func(ctx context.Context) error {
			resp, err := b.client.AppsV1().Deployments("").List(ctx, metav1.ListOptions{})
			switch {
			case err == nil:
				mu.Lock()
				deploymentCount = len(resp.Items)
				mu.Unlock()
				return nil
			case apierrors.IsForbidden(err):
				klog.V(2).Info("cluster-overview fallback: deployment list forbidden; proceeding without deployment count")
				return nil
			default:
				return err
			}
		},
		func(ctx context.Context) error {
			resp, err := b.client.AppsV1().ReplicaSets("").List(ctx, metav1.ListOptions{})
			switch {
			case err == nil:
				mu.Lock()
				replicaSets = parallel.CopyToPointers(resp.Items)
				mu.Unlock()
				return nil
			case apierrors.IsForbidden(err):
				klog.V(2).Info("cluster-overview fallback: replicaset list forbidden; deployment usage may be incomplete")
				return nil
			default:
				return err
			}
		},
		func(ctx context.Context) error {
			resp, err := b.client.AppsV1().StatefulSets("").List(ctx, metav1.ListOptions{})
			switch {
			case err == nil:
				mu.Lock()
				statefulSetCount = len(resp.Items)
				mu.Unlock()
				return nil
			case apierrors.IsForbidden(err):
				klog.V(2).Info("cluster-overview fallback: statefulset list forbidden; proceeding without statefulset count")
				return nil
			default:
				return err
			}
		},
		func(ctx context.Context) error {
			resp, err := b.client.AppsV1().DaemonSets("").List(ctx, metav1.ListOptions{})
			switch {
			case err == nil:
				mu.Lock()
				daemonSetCount = len(resp.Items)
				mu.Unlock()
				return nil
			case apierrors.IsForbidden(err):
				klog.V(2).Info("cluster-overview fallback: daemonset list forbidden; proceeding without daemonset count")
				return nil
			default:
				return err
			}
		},
		func(ctx context.Context) error {
			resp, err := b.client.BatchV1().CronJobs("").List(ctx, metav1.ListOptions{})
			switch {
			case err == nil:
				mu.Lock()
				cronJobCount = len(resp.Items)
				mu.Unlock()
				return nil
			case apierrors.IsForbidden(err):
				klog.V(2).Info("cluster-overview fallback: cronjob list forbidden; proceeding without cronjob count")
				return nil
			default:
				return err
			}
		},
		func(ctx context.Context) error {
			resp, err := b.client.CoreV1().Events("").List(ctx, metav1.ListOptions{})
			switch {
			case err == nil:
				events := parallel.CopyToPointers(resp.Items)
				mu.Lock()
				recentEvents = buildRecentEvents(events, ClusterMetaFromContext(ctx))
				mu.Unlock()
				return nil
			case apierrors.IsForbidden(err):
				klog.V(2).Info("cluster-overview fallback: event list forbidden; proceeding without recent warning events")
				return nil
			default:
				return err
			}
		},
	}

	if err := parallel.RunLimited(ctx, 4, tasks...); err != nil {
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

	// The list fallback projects its typed pods to the same PodAggregate rows the
	// informer path reads from ingest. WorkloadKind (the metrics-bucketing kind) is
	// resolved through an RS lister built from the RS list the fallback already
	// fetched, so the bucketing matches the prior buildClusterOverviewReplicaSetDeploymentMap
	// resolution. The per-pod RV is the version watermark contribution.
	rsLister := replicaSetListerFromSlice(replicaSets)
	podAggregates := make([]streamrows.PodAggregate, 0, len(pods))
	var podVersion uint64
	for _, pod := range pods {
		if pod == nil {
			continue
		}
		podAggregates = append(podAggregates, projectPodAggregate(pod, rsLister))
		if v := resourceVersionOrTimestamp(pod); v > podVersion {
			podVersion = v
		}
	}

	// The list fallback projects its typed nodes to the same nodeOverviewFact the informer
	// path reads from ingest, so the overview's per-node counting stays byte-equivalent.
	nodeFacts := make([]nodeOverviewFact, 0, len(nodes))
	for _, node := range nodes {
		if node == nil {
			continue
		}
		nodeFacts = append(nodeFacts, projectNodeOverviewFact(node))
	}

	snapshot, err := buildClusterOverviewSnapshot(ctx, scope, nodeFacts, podAggregates, podVersion, namespaces, b.metrics, versionFn, b.serverHost)
	if err != nil {
		return nil, err
	}
	applyClusterOverviewExtras(snapshot, clusterOverviewExtras{
		totalDeployments:  deploymentCount,
		totalStatefulSets: statefulSetCount,
		totalDaemonSets:   daemonSetCount,
		totalCronJobs:     cronJobCount,
		recentEvents:      recentEvents,
	})
	return snapshot, nil
}

// Build assembles the cluster overview payload from cached resources and metrics.
func (b *ClusterOverviewBuilder) Build(ctx context.Context, scope string) (*refresh.Snapshot, error) {
	return b.buildFromListers(ctx, scope)
}

func buildClusterOverviewSnapshot(
	ctx context.Context,
	scope string,
	nodes []nodeOverviewFact,
	podAggregates []streamrows.PodAggregate,
	podVersion uint64,
	namespaces []*corev1.Namespace,
	provider metrics.Provider,
	versionFn func(context.Context) string,
	serverHost string,
) (*refresh.Snapshot, error) {
	meta := ClusterMetaFromContext(ctx)
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
	podUsage := map[string]metrics.PodUsage{}

	nonFargateNodes := 0
	virtualKubeletNodes := 0

	for _, node := range nodes {
		overview.TotalNodes++
		if node.Version > version {
			version = node.Version
		}

		cpuAllocatableMilli += node.AllocatableCPUMilli
		memAllocatableBytes += node.AllocatableMemoryBytes

		// Node health — Ready condition and cordoned state are tracked for all
		// nodes regardless of compute type (Fargate, virtual-kubelet, etc.).
		if node.Ready {
			overview.ReadyNodes++
		} else {
			overview.NotReadyNodes++
		}
		if node.Unschedulable {
			overview.CordonedNodes++
		}

		// EKS Fargate nodes carry the eks.amazonaws.com/compute-type label.
		if node.IsFargate {
			overview.FargateNodes++
			continue
		}
		// AKS Virtual Nodes (backed by Azure Container Instances) carry
		// the type=virtual-kubelet label, set by the virtual-kubelet binary.
		if node.IsVirtualKubelet {
			virtualKubeletNodes++
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
		podUsage = usage
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
	overview.WorkloadResourceUsage = buildWorkloadResourceUsage(podAggregates, podUsage)

	// Pods are projected: the per-pod RV is gone with the typed object, so the pod
	// contribution to the version watermark is the pod store's latest list/watch RV
	// (the informer path) or the max typed-pod RV (the list fallback), folded once.
	if podVersion > version {
		version = podVersion
	}

	for _, agg := range podAggregates {
		overview.TotalPods++

		switch agg.Phase {
		case string(corev1.PodRunning):
			overview.RunningPods++
		case string(corev1.PodSucceeded):
			overview.SucceededPods++
		case string(corev1.PodPending):
			overview.PendingPods++
		case string(corev1.PodFailed):
			overview.FailedPods++
		}

		overview.TotalContainers += agg.ContainerCount
		overview.TotalInitContainers += agg.InitContainerCount

		countPodStatusPresentation(&overview, agg.StatusPresentation)
		// Not-ready signal: an unfinished pod (not Succeeded) whose containers are
		// not all ready. Mirrors the prior podCountsAsNotReadySignal check.
		if agg.Phase != string(corev1.PodSucceeded) && agg.TotalContainers > 0 && agg.ReadyContainers < agg.TotalContainers {
			overview.NotReadyPods++
		}

		// Overview totals add regular + init container resources together.
		cpuRequestsMilli += agg.CPURequestMilli + agg.InitCPURequestMilli
		cpuLimitsMilli += agg.CPULimitMilli + agg.InitCPULimitMilli
		memRequestsBytes += agg.MemRequestBytes + agg.InitMemRequestBytes
		memLimitsBytes += agg.MemLimitBytes + agg.InitMemLimitBytes

		// hasRestarts previously checked container + init + EPHEMERAL restart
		// statuses; RestartCountFacts sums exactly those three, so >0 is equivalent.
		if agg.RestartCountFacts > 0 {
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
	switch clusterType {
	case "EKS":
		overview.EC2Nodes = nonFargateNodes
	case "AKS":
		overview.VirtualNodes = virtualKubeletNodes
		overview.VMNodes = nonFargateNodes
	default:
		overview.RegularNodes = nonFargateNodes
	}

	return &refresh.Snapshot{
		Domain:  clusterOverviewDomainName,
		Scope:   scope,
		Version: version,
		Payload: ClusterOverviewSnapshot{
			ClusterMeta: meta,
			Overview:    overview,
			Metrics:     metricsSnapshot,
		},
		Stats: refresh.SnapshotStats{
			ItemCount: overview.TotalNodes,
		},
	}, nil
}

func (b *ClusterOverviewBuilder) waitForInformerSync(ctx context.Context) error {
	if len(b.hasSyncedFns) == 0 && len(b.requiredIngestGVRs) == 0 {
		return nil
	}
	if b.synced.Load() == 1 {
		return nil
	}
	ticker := time.NewTicker(config.RefreshInformerSyncPollInterval)
	defer ticker.Stop()

	for {
		if b.requiredSourcesSynced() {
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

func (b *ClusterOverviewBuilder) requiredSourcesSynced() bool {
	for _, fn := range b.hasSyncedFns {
		if fn == nil {
			continue
		}
		if !fn() {
			return false
		}
	}
	for _, gvr := range b.requiredIngestGVRs {
		if b.ingest == nil || !b.ingest.HasSyncedFor(gvr) {
			return false
		}
	}
	return true
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
		return fmt.Sprintf("%.1f Ki", float64(bytes)/float64(ki))
	}
	if bytes < gi {
		return fmt.Sprintf("%.1f Mi", float64(bytes)/float64(mi))
	}
	if bytes < ti {
		return fmt.Sprintf("%.1f Gi", float64(bytes)/float64(gi))
	}
	return fmt.Sprintf("%.1f Ti", float64(bytes)/float64(ti))
}

type workloadUsageTotals struct {
	cpuMilli int64
	memBytes int64
}

// buildWorkloadResourceUsage buckets pod metrics usage by the workload kind each pod
// belongs to, reading the metrics-bucketing kind from the projected aggregate's
// WorkloadKind (the controlling owner's kind with a ReplicaSet resolved to its
// Deployment via the RS lister at projection time). This is the exact resolution the
// old clusterOverviewWorkloadKind/buildClusterOverviewReplicaSetDeploymentMap applied
// inline — proven byte-equivalent in pod_aggregate_test.go — so the buckets are
// unchanged, but no typed pod or RS list is read here.
func buildWorkloadResourceUsage(podAggregates []streamrows.PodAggregate, podUsage map[string]metrics.PodUsage) WorkloadResourceUsage {
	totals := map[string]workloadUsageTotals{
		deploymentpkg.Identity.Kind:  {},
		daemonsetpkg.Identity.Kind:   {},
		statefulsetpkg.Identity.Kind: {},
		jobpkg.Identity.Kind:         {},
	}

	for _, agg := range podAggregates {
		usage, ok := podUsage[podMetricKey(agg.Namespace, agg.Name)]
		if !ok {
			continue
		}
		current, ok := totals[agg.WorkloadKind]
		if !ok {
			continue
		}
		current.cpuMilli += usage.CPUUsageMilli
		current.memBytes += usage.MemoryUsageBytes
		totals[agg.WorkloadKind] = current
	}

	return WorkloadResourceUsage{
		Deployments:  formatWorkloadTypeResourceUsage(totals[deploymentpkg.Identity.Kind]),
		DaemonSets:   formatWorkloadTypeResourceUsage(totals[daemonsetpkg.Identity.Kind]),
		StatefulSets: formatWorkloadTypeResourceUsage(totals[statefulsetpkg.Identity.Kind]),
		Jobs:         formatWorkloadTypeResourceUsage(totals[jobpkg.Identity.Kind]),
	}
}

// replicaSetListerFromSlice builds a ReplicaSet lister backed by an in-memory indexer
// over the supplied slice. The cluster-overview list fallback uses it to resolve a
// pod's metrics-bucketing workload kind through projectPodAggregate (which needs a
// lister, not a slice) — so the fallback's WorkloadKind resolution matches the informer
// path's exactly, from the RS list the fallback already fetched.
func replicaSetListerFromSlice(replicaSets []*appsv1.ReplicaSet) appslisters.ReplicaSetLister {
	indexer := cache.NewIndexer(cache.MetaNamespaceKeyFunc, cache.Indexers{cache.NamespaceIndex: cache.MetaNamespaceIndexFunc})
	for _, rs := range replicaSets {
		if rs == nil {
			continue
		}
		// Add cannot fail for a well-formed object with the standard key func; a
		// malformed object would simply be omitted, leaving its pods' WorkloadKind
		// unresolved — the same outcome the map path had for an absent RS.
		_ = indexer.Add(rs)
	}
	return appslisters.NewReplicaSetLister(indexer)
}

func countPodStatusPresentation(overview *ClusterOverviewPayload, presentation string) {
	if overview == nil {
		return
	}
	switch strings.ToLower(strings.TrimSpace(presentation)) {
	case "ready":
		overview.ReadyPods++
	case "warning":
		overview.StartingPods++
	case "error", "not-ready":
		overview.FailingPods++
	case "terminating":
		overview.TerminatingPods++
	}
}

func formatWorkloadTypeResourceUsage(totals workloadUsageTotals) WorkloadTypeResourceUsage {
	return WorkloadTypeResourceUsage{
		CPUUsage:    formatCPUValue(totals.cpuMilli),
		MemoryUsage: formatMemoryValue(totals.memBytes),
	}
}

func podMetricKey(namespace, name string) string {
	return namespace + "/" + name
}

type clusterOverviewExtras struct {
	totalDeployments  int
	totalStatefulSets int
	totalDaemonSets   int
	totalCronJobs     int
	recentEvents      []RecentEvent
}

func applyClusterOverviewExtras(snapshot *refresh.Snapshot, extras clusterOverviewExtras) {
	if snapshot == nil {
		return
	}
	payload, ok := snapshot.Payload.(ClusterOverviewSnapshot)
	if !ok {
		return
	}
	payload.Overview.TotalDeployments = extras.totalDeployments
	payload.Overview.TotalStatefulSets = extras.totalStatefulSets
	payload.Overview.TotalDaemonSets = extras.totalDaemonSets
	payload.Overview.TotalCronJobs = extras.totalCronJobs
	payload.Overview.RecentEvents = extras.recentEvents
	snapshot.Payload = payload
}

func informerSynced(fn cache.InformerSynced) bool {
	return fn == nil || fn()
}

func (b *ClusterOverviewBuilder) buildFromListers(ctx context.Context, scope string) (*refresh.Snapshot, error) {
	if err := b.waitForInformerSync(ctx); err != nil {
		return nil, err
	}

	type listResult[T any] struct {
		items []*T
		err   error
	}

	var (
		namespaceRes listResult[corev1.Namespace]
	)
	var deploymentCount, statefulSetCount, daemonSetCount, cronJobCount int
	var recentEvents []RecentEvent

	tasks := []func(context.Context) error{
		func(context.Context) error {
			list, err := b.namespaceLister.List(labels.Everything())
			namespaceRes.items = list
			namespaceRes.err = err
			return err
		},
		// Deployment/StatefulSet/DaemonSet/CronJob are cut to the ingest path: their counts
		// are the number of projected catalog rows in each kind's ingest store, gated on the
		// store having synced (the ingest equivalent of the prior informerSynced gate, so an
		// unsynced store contributes 0 rather than an undercount).
		func(context.Context) error {
			deploymentCount = b.workloadIngestCount(DeploymentGVR)
			return nil
		},
		func(context.Context) error {
			statefulSetCount = b.workloadIngestCount(StatefulSetGVR)
			return nil
		},
		func(context.Context) error {
			daemonSetCount = b.workloadIngestCount(DaemonSetGVR)
			return nil
		},
		func(context.Context) error {
			cronJobCount = b.workloadIngestCount(CronJobGVR)
			return nil
		},
		func(context.Context) error {
			if b.eventLister == nil || !informerSynced(b.eventHasSynced) {
				return nil
			}
			events, err := b.eventLister.List(labels.Everything())
			if err != nil {
				return err
			}
			recentEvents = buildRecentEvents(events, ClusterMetaFromContext(ctx))
			return nil
		},
	}

	if err := parallel.RunLimited(ctx, 4, tasks...); err != nil {
		return nil, err
	}
	if namespaceRes.err != nil {
		return nil, namespaceRes.err
	}

	// Nodes are cut to the ingest path: the per-node overview facts come from the projected
	// node store, gated on the store having synced (the ingest equivalent of the prior node
	// informer HasSynced gate, so an unsynced store contributes no nodes rather than a partial
	// count). Pods likewise come from the ingest store: the projected PodAggregate rows plus
	// the store's latest RV as the pod version watermark.
	var nodeFacts []nodeOverviewFact
	if b.ingest != nil && b.ingest.HasSyncedFor(NodeGVR) {
		nodeFacts = nodeOverviewFactsFromIngest(b.ingest)
	}
	podAggregates := podAggregatesFromIngest(b.ingest)
	podVersion := podIngestVersion(b.ingest)
	snapshot, err := buildClusterOverviewSnapshot(ctx, scope, nodeFacts, podAggregates, podVersion, namespaceRes.items, b.metrics, b.serverVersion, b.serverHost)
	if err != nil {
		return nil, err
	}
	applyClusterOverviewExtras(snapshot, clusterOverviewExtras{
		totalDeployments:  deploymentCount,
		totalStatefulSets: statefulSetCount,
		totalDaemonSets:   daemonSetCount,
		totalCronJobs:     cronJobCount,
		recentEvents:      recentEvents,
	})
	return snapshot, nil
}

// buildRecentEvents filters events down to recent warnings and packages the
// subset consumed by the Cluster Overview "Recent Events" section.
func buildRecentEvents(events []*corev1.Event, meta ClusterMeta) []RecentEvent {
	cutoff := time.Now().Add(-config.SnapshotClusterOverviewRecentEventsLookback)
	filtered := make([]*corev1.Event, 0, len(events))
	for _, evt := range events {
		if evt == nil {
			continue
		}
		if !strings.EqualFold(evt.Type, corev1.EventTypeWarning) {
			continue
		}
		if eventTimestamp(evt).Before(cutoff) {
			continue
		}
		filtered = append(filtered, evt)
	}

	sort.Slice(filtered, func(i, j int) bool {
		return compareEventOrder(filtered[i], filtered[j]) < 0
	})

	if len(filtered) > config.SnapshotClusterOverviewRecentEventsLimit {
		filtered = filtered[:config.SnapshotClusterOverviewRecentEventsLimit]
	}

	out := make([]RecentEvent, 0, len(filtered))
	for _, evt := range filtered {
		facts := eventres.BuildFacts(meta.ClusterID, evt)
		out = append(out, RecentEvent{
			ClusterID:        meta.ClusterID,
			ClusterName:      meta.ClusterName,
			InvolvedObject:   facts.InvolvedObject,
			EventUID:         string(evt.UID),
			Reason:           strings.TrimSpace(evt.Reason),
			Message:          eventres.EventMessage(evt),
			Timestamp:        eventres.EventTimestamp(evt).UnixMilli(),
			ObjectKind:       evt.InvolvedObject.Kind,
			ObjectName:       evt.InvolvedObject.Name,
			ObjectNamespace:  evt.InvolvedObject.Namespace,
			ObjectAPIVersion: evt.InvolvedObject.APIVersion,
			ObjectUID:        string(evt.InvolvedObject.UID),
		})
	}
	return out
}
