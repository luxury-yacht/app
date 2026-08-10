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
	"github.com/luxury-yacht/app/backend/refresh/permissions"
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
	// PermissionSkippedFor reports whether the gvr's reflector was permission-skipped at
	// Start (the identity cannot list+watch the kind). The overview marks such a source
	// permission-unavailable: its store settles empty, and the runtime list SSAR alone
	// misses the list-without-watch identity.
	PermissionSkippedFor(gvr schema.GroupVersionResource) bool
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
	// Disabled marks a terminal "metrics unavailable" state (forbidden, or
	// metrics-server absent); LastError then carries the permanent reason.
	Disabled bool `json:"disabled,omitempty"`
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

	// UnavailableResources lists the overview's primary sources (canonical
	// group/resource keys — core/nodes, core/pods, core/namespaces) the current
	// identity cannot list, so the frontend renders the affected cards as
	// permission-gated instead of zero-valued (issue #244). Empty/omitted means
	// every source was readable.
	UnavailableResources []string `json:"unavailableResources,omitempty"`
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
	data := newClusterOverviewListData()
	if err := parallel.RunLimited(ctx, 4, b.listTasks(data)...); err != nil {
		return nil, err
	}
	data.normalizeForbiddenSources()
	podAggregates, podVersion := projectClusterOverviewPods(data.pods, data.replicaSets)
	nodeFacts := projectClusterOverviewNodes(data.nodes)
	snapshot, err := buildClusterOverviewSnapshot(ctx, scope, clusterOverviewSnapshotInputs{
		nodes: nodeFacts, podAggregates: podAggregates, podVersion: podVersion, namespaces: data.namespaces,
		provider: b.metrics, versionFn: clusterOverviewVersionFunc(b.versionFn), serverHost: b.serverHost,
	})
	if err != nil {
		return nil, err
	}
	applyClusterOverviewExtras(snapshot, clusterOverviewExtras{
		totalDeployments:     data.deploymentCount,
		totalStatefulSets:    data.statefulSetCount,
		totalDaemonSets:      data.daemonSetCount,
		totalCronJobs:        data.cronJobCount,
		recentEvents:         data.recentEvents,
		unavailableResources: clusterOverviewUnavailable(!data.nodesForbidden, !data.podsForbidden, !data.namespacesDenied),
	})
	return snapshot, nil
}

type clusterOverviewListData struct {
	mu               sync.Mutex
	nodes            []*corev1.Node
	pods             []*corev1.Pod
	namespaces       []*corev1.Namespace
	replicaSets      []*appsv1.ReplicaSet
	recentEvents     []RecentEvent
	deploymentCount  int
	statefulSetCount int
	daemonSetCount   int
	cronJobCount     int
	nodesForbidden   bool
	podsForbidden    bool
	namespacesDenied bool
}

func newClusterOverviewListData() *clusterOverviewListData {
	return &clusterOverviewListData{recentEvents: make([]RecentEvent, 0)}
}

func (b *ClusterOverviewListBuilder) listTasks(data *clusterOverviewListData) []func(context.Context) error {
	return []func(context.Context) error{
		func(ctx context.Context) error { return data.listNodes(ctx, b.client) },
		func(ctx context.Context) error { return data.listPods(ctx, b.client) },
		func(ctx context.Context) error { return data.listNamespaces(ctx, b.client) },
		func(ctx context.Context) error { return data.listDeployments(ctx, b.client) },
		func(ctx context.Context) error { return data.listReplicaSets(ctx, b.client) },
		func(ctx context.Context) error { return data.listStatefulSets(ctx, b.client) },
		func(ctx context.Context) error { return data.listDaemonSets(ctx, b.client) },
		func(ctx context.Context) error { return data.listCronJobs(ctx, b.client) },
		func(ctx context.Context) error { return data.listEvents(ctx, b.client) },
	}
}

func (d *clusterOverviewListData) listNodes(ctx context.Context, client kubernetes.Interface) error {
	resp, err := client.CoreV1().Nodes().List(ctx, metav1.ListOptions{})
	if apierrors.IsForbidden(err) {
		klog.V(2).Info("cluster-overview fallback: node list forbidden; proceeding without node summary")
		d.withLock(func() { d.nodesForbidden = true })
		return nil
	}
	if err != nil {
		return err
	}
	d.withLock(func() { d.nodes = parallel.CopyToPointers(resp.Items) })
	return nil
}

func (d *clusterOverviewListData) listPods(ctx context.Context, client kubernetes.Interface) error {
	resp, err := client.CoreV1().Pods("").List(ctx, metav1.ListOptions{})
	if apierrors.IsForbidden(err) {
		klog.V(2).Info("cluster-overview fallback: pod list forbidden; proceeding without pod metrics")
		d.withLock(func() { d.podsForbidden = true })
		return nil
	}
	if err != nil {
		return err
	}
	d.withLock(func() { d.pods = parallel.CopyToPointers(resp.Items) })
	return nil
}

func (d *clusterOverviewListData) listNamespaces(ctx context.Context, client kubernetes.Interface) error {
	resp, err := client.CoreV1().Namespaces().List(ctx, metav1.ListOptions{})
	if apierrors.IsForbidden(err) {
		klog.V(2).Info("cluster-overview fallback: namespace list forbidden; proceeding with empty namespace set")
		d.withLock(func() { d.namespacesDenied = true })
		return nil
	}
	if err != nil {
		return err
	}
	d.withLock(func() { d.namespaces = parallel.CopyToPointers(resp.Items) })
	return nil
}

func (d *clusterOverviewListData) listDeployments(ctx context.Context, client kubernetes.Interface) error {
	resp, err := client.AppsV1().Deployments("").List(ctx, metav1.ListOptions{})
	if apierrors.IsForbidden(err) {
		klog.V(2).Info("cluster-overview fallback: deployment list forbidden; proceeding without deployment count")
		return nil
	}
	if err != nil {
		return err
	}
	d.withLock(func() { d.deploymentCount = len(resp.Items) })
	return nil
}

func (d *clusterOverviewListData) listReplicaSets(ctx context.Context, client kubernetes.Interface) error {
	resp, err := client.AppsV1().ReplicaSets("").List(ctx, metav1.ListOptions{})
	if apierrors.IsForbidden(err) {
		klog.V(2).Info("cluster-overview fallback: replicaset list forbidden; deployment usage may be incomplete")
		return nil
	}
	if err != nil {
		return err
	}
	d.withLock(func() { d.replicaSets = parallel.CopyToPointers(resp.Items) })
	return nil
}

func (d *clusterOverviewListData) listStatefulSets(ctx context.Context, client kubernetes.Interface) error {
	resp, err := client.AppsV1().StatefulSets("").List(ctx, metav1.ListOptions{})
	if apierrors.IsForbidden(err) {
		klog.V(2).Info("cluster-overview fallback: statefulset list forbidden; proceeding without statefulset count")
		return nil
	}
	if err != nil {
		return err
	}
	d.withLock(func() { d.statefulSetCount = len(resp.Items) })
	return nil
}

func (d *clusterOverviewListData) listDaemonSets(ctx context.Context, client kubernetes.Interface) error {
	resp, err := client.AppsV1().DaemonSets("").List(ctx, metav1.ListOptions{})
	if apierrors.IsForbidden(err) {
		klog.V(2).Info("cluster-overview fallback: daemonset list forbidden; proceeding without daemonset count")
		return nil
	}
	if err != nil {
		return err
	}
	d.withLock(func() { d.daemonSetCount = len(resp.Items) })
	return nil
}

func (d *clusterOverviewListData) listCronJobs(ctx context.Context, client kubernetes.Interface) error {
	resp, err := client.BatchV1().CronJobs("").List(ctx, metav1.ListOptions{})
	if apierrors.IsForbidden(err) {
		klog.V(2).Info("cluster-overview fallback: cronjob list forbidden; proceeding without cronjob count")
		return nil
	}
	if err != nil {
		return err
	}
	d.withLock(func() { d.cronJobCount = len(resp.Items) })
	return nil
}

func (d *clusterOverviewListData) listEvents(ctx context.Context, client kubernetes.Interface) error {
	resp, err := client.CoreV1().Events("").List(ctx, metav1.ListOptions{})
	if apierrors.IsForbidden(err) {
		klog.V(2).Info("cluster-overview fallback: event list forbidden; proceeding without recent warning events")
		return nil
	}
	if err != nil {
		return err
	}
	events := buildRecentEvents(parallel.CopyToPointers(resp.Items), ClusterMetaFromContext(ctx))
	d.withLock(func() { d.recentEvents = events })
	return nil
}

func (d *clusterOverviewListData) withLock(update func()) {
	d.mu.Lock()
	update()
	d.mu.Unlock()
}

func (d *clusterOverviewListData) normalizeForbiddenSources() {
	if d.podsForbidden {
		d.pods = nil
	}
	if d.namespacesDenied {
		d.namespaces = nil
	}
}

func clusterOverviewVersionFunc(versionFn func(context.Context) string) func(context.Context) string {
	if versionFn != nil {
		return versionFn
	}
	return func(context.Context) string { return defaultClusterVersion("") }
}

func projectClusterOverviewPods(
	pods []*corev1.Pod,
	replicaSets []*appsv1.ReplicaSet,
) ([]streamrows.PodAggregate, uint64) {
	rsLister := replicaSetListerFromSlice(replicaSets)
	aggregates := make([]streamrows.PodAggregate, 0, len(pods))
	var version uint64
	for _, pod := range pods {
		if pod == nil {
			continue
		}
		aggregates = append(aggregates, projectPodAggregate(pod, PodOwnerSources{ReplicaSets: rsLister}))
		version = maxSnapshotVersion(version, pod)
	}
	return aggregates, version
}

func projectClusterOverviewNodes(nodes []*corev1.Node) []nodeOverviewFact {
	facts := make([]nodeOverviewFact, 0, len(nodes))
	for _, node := range nodes {
		if node != nil {
			facts = append(facts, projectNodeOverviewFact(node))
		}
	}
	return facts
}

// clusterOverviewUnavailable returns the canonical group/resource keys of the
// overview's primary sources denied for this build, the payload's
// UnavailableResources contract.
func clusterOverviewUnavailable(nodesAllowed, podsAllowed, namespacesAllowed bool) []string {
	var out []string
	if !nodesAllowed {
		out = append(out, permissions.ResourceKey("", "nodes"))
	}
	if !podsAllowed {
		out = append(out, permissions.ResourceKey("", "pods"))
	}
	if !namespacesAllowed {
		out = append(out, permissions.ResourceKey("", "namespaces"))
	}
	return out
}

// Build assembles the cluster overview payload from cached resources and metrics.
func (b *ClusterOverviewBuilder) Build(ctx context.Context, scope string) (*refresh.Snapshot, error) {
	return b.buildFromListers(ctx, scope)
}

type clusterOverviewSnapshotInputs struct {
	nodes         []nodeOverviewFact
	podAggregates []streamrows.PodAggregate
	podVersion    uint64
	namespaces    []*corev1.Namespace
	provider      metrics.Provider
	versionFn     func(context.Context) string
	serverHost    string
}

func buildClusterOverviewSnapshot(ctx context.Context, scope string, inputs clusterOverviewSnapshotInputs) (*refresh.Snapshot, error) {
	accumulator := clusterOverviewAccumulator{}
	for _, node := range inputs.nodes {
		accumulator.addNode(node)
	}
	metricsResult := buildClusterOverviewMetrics(inputs.provider)
	accumulator.cpuUsageMilli = metricsResult.cpuUsageMilli
	accumulator.memUsageBytes = metricsResult.memUsageBytes
	accumulator.overview.WorkloadResourceUsage = buildWorkloadResourceUsage(inputs.podAggregates, metricsResult.podUsage)
	accumulator.version = maxClusterOverviewVersion(accumulator.version, inputs.podVersion)
	for _, agg := range inputs.podAggregates {
		accumulator.addPod(agg)
	}
	for _, ns := range inputs.namespaces {
		accumulator.addNamespace(ns)
	}
	accumulator.finalize(ctx, inputs.versionFn, inputs.serverHost)
	return &refresh.Snapshot{
		Domain:  clusterOverviewDomainName,
		Scope:   scope,
		Version: accumulator.version,
		Payload: ClusterOverviewSnapshot{
			ClusterMeta: ClusterMetaFromContext(ctx),
			Overview:    accumulator.overview,
			Metrics:     metricsResult.snapshot,
		},
		Stats: refresh.SnapshotStats{
			ItemCount: accumulator.overview.TotalNodes,
		},
	}, nil
}

type clusterOverviewAccumulator struct {
	overview            ClusterOverviewPayload
	version             uint64
	cpuAllocatableMilli int64
	cpuRequestsMilli    int64
	cpuLimitsMilli      int64
	cpuUsageMilli       int64
	memAllocatableBytes int64
	memRequestsBytes    int64
	memLimitsBytes      int64
	memUsageBytes       int64
	nonFargateNodes     int
	virtualKubeletNodes int
}

func (a *clusterOverviewAccumulator) addNode(node nodeOverviewFact) {
	a.overview.TotalNodes++
	a.version = maxClusterOverviewVersion(a.version, node.Version)
	a.cpuAllocatableMilli += node.AllocatableCPUMilli
	a.memAllocatableBytes += node.AllocatableMemoryBytes
	if node.Ready {
		a.overview.ReadyNodes++
	} else {
		a.overview.NotReadyNodes++
	}
	if node.Unschedulable {
		a.overview.CordonedNodes++
	}
	if node.IsFargate {
		a.overview.FargateNodes++
		return
	}
	if node.IsVirtualKubelet {
		a.virtualKubeletNodes++
		return
	}
	a.nonFargateNodes++
}

func (a *clusterOverviewAccumulator) addPod(aggregate streamrows.PodAggregate) {
	a.overview.TotalPods++
	a.addPodPhase(aggregate.Phase)
	a.overview.TotalContainers += aggregate.ContainerCount
	a.overview.TotalInitContainers += aggregate.InitContainerCount
	countPodStatusPresentation(&a.overview, aggregate.StatusPresentation)
	if podCountsAsNotReadySignal(aggregate.Phase, aggregate.ReadyContainers, aggregate.TotalContainers) {
		a.overview.NotReadyPods++
	}
	a.cpuRequestsMilli += aggregate.CPURequestMilli + aggregate.InitCPURequestMilli
	a.cpuLimitsMilli += aggregate.CPULimitMilli + aggregate.InitCPULimitMilli
	a.memRequestsBytes += aggregate.MemRequestBytes + aggregate.InitMemRequestBytes
	a.memLimitsBytes += aggregate.MemLimitBytes + aggregate.InitMemLimitBytes
	if aggregate.RestartCountFacts > 0 {
		a.overview.RestartedPods++
	}
}

func (a *clusterOverviewAccumulator) addPodPhase(phase string) {
	switch phase {
	case string(corev1.PodRunning):
		a.overview.RunningPods++
	case string(corev1.PodSucceeded):
		a.overview.SucceededPods++
	case string(corev1.PodPending):
		a.overview.PendingPods++
	case string(corev1.PodFailed):
		a.overview.FailedPods++
	}
}

func (a *clusterOverviewAccumulator) addNamespace(namespace *corev1.Namespace) {
	if namespace == nil {
		return
	}
	a.overview.TotalNamespaces++
	a.version = maxSnapshotVersion(a.version, namespace)
}

func maxClusterOverviewVersion(current, candidate uint64) uint64 {
	if candidate > current {
		return candidate
	}
	return current
}

func (a *clusterOverviewAccumulator) finalize(
	ctx context.Context,
	versionFn func(context.Context) string,
	serverHost string,
) {
	a.overview.CPUUsage = formatCPUValue(a.cpuUsageMilli)
	a.overview.CPURequests = formatCPUValue(a.cpuRequestsMilli)
	a.overview.CPULimits = formatCPUValue(a.cpuLimitsMilli)
	a.overview.CPUAllocatable = formatCPUValue(a.cpuAllocatableMilli)
	a.overview.MemoryUsage = formatMemoryValue(a.memUsageBytes)
	a.overview.MemoryRequests = formatMemoryValue(a.memRequestsBytes)
	a.overview.MemoryLimits = formatMemoryValue(a.memLimitsBytes)
	a.overview.MemoryAllocatable = formatMemoryValue(a.memAllocatableBytes)
	if versionFn != nil {
		a.overview.ClusterVersion = versionFn(ctx)
	}
	a.overview.ClusterVersion = defaultClusterVersion(a.overview.ClusterVersion)
	a.applyClusterType(detectClusterType(a.overview.ClusterVersion, serverHost))
}

func (a *clusterOverviewAccumulator) applyClusterType(clusterType string) {
	a.overview.ClusterType = clusterType
	switch clusterType {
	case "EKS":
		a.overview.EC2Nodes = a.nonFargateNodes
	case "AKS":
		a.overview.VirtualNodes = a.virtualKubeletNodes
		a.overview.VMNodes = a.nonFargateNodes
	default:
		a.overview.RegularNodes = a.nonFargateNodes
	}
}

type clusterOverviewMetricsResult struct {
	snapshot      ClusterOverviewMetrics
	podUsage      map[string]metrics.PodUsage
	cpuUsageMilli int64
	memUsageBytes int64
}

func buildClusterOverviewMetrics(provider metrics.Provider) clusterOverviewMetricsResult {
	result := clusterOverviewMetricsResult{
		snapshot: ClusterOverviewMetrics{Stale: true},
		podUsage: map[string]metrics.PodUsage{},
	}
	if provider == nil {
		return result
	}
	result.podUsage = provider.LatestPodUsage()
	for _, usage := range result.podUsage {
		result.cpuUsageMilli += usage.CPUUsageMilli
		result.memUsageBytes += usage.MemoryUsageBytes
	}
	meta := provider.Metadata()
	result.snapshot = clusterOverviewMetricsSnapshot(meta)
	return result
}

func clusterOverviewMetricsSnapshot(meta metrics.Metadata) ClusterOverviewMetrics {
	lastError := meta.LastError
	if !meta.Disabled && meta.SuccessCount == 0 && meta.CollectedAt.IsZero() && meta.ConsecutiveFailures < 5 {
		lastError = ""
	}
	snapshot := ClusterOverviewMetrics{
		Stale:               !meta.CollectedAt.IsZero() && time.Since(meta.CollectedAt) > config.MetricsStaleWindow,
		LastError:           lastError,
		ConsecutiveFailures: meta.ConsecutiveFailures,
		SuccessCount:        meta.SuccessCount,
		FailureCount:        meta.FailureCount,
		Disabled:            meta.Disabled,
	}
	if !meta.CollectedAt.IsZero() {
		snapshot.CollectedAt = meta.CollectedAt.Unix()
	}
	return snapshot
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

func detectClusterType(version, serverHost string) string {
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
	totalDeployments     int
	totalStatefulSets    int
	totalDaemonSets      int
	totalCronJobs        int
	recentEvents         []RecentEvent
	unavailableResources []string
}

type clusterOverviewAvailability struct {
	nodes      bool
	pods       bool
	namespaces bool
}

type clusterOverviewListerInputs struct {
	namespaces []*corev1.Namespace
	extras     clusterOverviewExtras
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
	payload.Overview.UnavailableResources = extras.unavailableResources
	snapshot.Payload = payload
}

func informerSynced(fn cache.InformerSynced) bool {
	return fn == nil || fn()
}

func (b *ClusterOverviewBuilder) buildFromListers(ctx context.Context, scope string) (*refresh.Snapshot, error) {
	if err := b.waitForInformerSync(ctx); err != nil {
		return nil, err
	}
	availability := b.clusterOverviewAvailability(ctx)
	inputs, err := b.collectClusterOverviewListerInputs(ctx, availability)
	if err != nil {
		return nil, err
	}

	// Nodes are cut to the ingest path: the per-node overview facts come from the projected
	// node store, gated on the store having synced (the ingest equivalent of the prior node
	// informer HasSynced gate, so an unsynced store contributes no nodes rather than a partial
	// count; a permission-skipped store settles empty). Pods likewise come from the ingest
	// store: the projected PodAggregate rows plus the store's latest RV as the pod version
	// watermark. A runtime-denied source is dropped even when its store still holds rows.
	nodeFacts := b.clusterOverviewNodeFacts(availability.nodes)
	podAggregates, podVersion := b.clusterOverviewPodInputs(availability.pods)
	snapshot, err := buildClusterOverviewSnapshot(ctx, scope, clusterOverviewSnapshotInputs{
		nodes: nodeFacts, podAggregates: podAggregates, podVersion: podVersion, namespaces: inputs.namespaces,
		provider: b.metrics, versionFn: b.serverVersion, serverHost: b.serverHost,
	})
	if err != nil {
		return nil, err
	}
	inputs.extras.unavailableResources = clusterOverviewUnavailable(availability.nodes, availability.pods, availability.namespaces)
	applyClusterOverviewExtras(snapshot, inputs.extras)
	return snapshot, nil
}

func (b *ClusterOverviewBuilder) clusterOverviewAvailability(ctx context.Context) clusterOverviewAvailability {
	// A permission-skipped ingest store has list but not watch permission, so its
	// rows cannot represent the current cluster and the source remains unavailable.
	return clusterOverviewAvailability{
		nodes: runtimeResourceAllowed(ctx, clusterOverviewDomainName, "", "nodes") &&
			!(b.ingest != nil && b.ingest.PermissionSkippedFor(NodeGVR)),
		pods: runtimeResourceAllowed(ctx, clusterOverviewDomainName, "", "pods") &&
			!(b.ingest != nil && b.ingest.PermissionSkippedFor(PodGVR)),
		namespaces: runtimeResourceAllowed(ctx, clusterOverviewDomainName, "", "namespaces"),
	}
}

func (b *ClusterOverviewBuilder) collectClusterOverviewListerInputs(ctx context.Context, availability clusterOverviewAvailability) (clusterOverviewListerInputs, error) {
	inputs := clusterOverviewListerInputs{extras: clusterOverviewExtras{recentEvents: make([]RecentEvent, 0)}}
	tasks := []func(context.Context) error{
		func(context.Context) error {
			var err error
			inputs.namespaces, err = b.listClusterOverviewNamespaces(availability.namespaces)
			return err
		},
		func(context.Context) error {
			inputs.extras.totalDeployments = b.workloadIngestCount(DeploymentGVR)
			return nil
		},
		func(context.Context) error {
			inputs.extras.totalStatefulSets = b.workloadIngestCount(StatefulSetGVR)
			return nil
		},
		func(context.Context) error {
			inputs.extras.totalDaemonSets = b.workloadIngestCount(DaemonSetGVR)
			return nil
		},
		func(context.Context) error {
			inputs.extras.totalCronJobs = b.workloadIngestCount(CronJobGVR)
			return nil
		},
		func(context.Context) error {
			var err error
			inputs.extras.recentEvents, err = b.listClusterOverviewRecentEvents(ctx)
			return err
		},
	}
	if err := parallel.RunLimited(ctx, 4, tasks...); err != nil {
		return clusterOverviewListerInputs{}, err
	}
	return inputs, nil
}

func (b *ClusterOverviewBuilder) listClusterOverviewNamespaces(allowed bool) ([]*corev1.Namespace, error) {
	if b.namespaceLister == nil || !allowed {
		return nil, nil
	}
	return b.namespaceLister.List(labels.Everything())
}

func (b *ClusterOverviewBuilder) listClusterOverviewRecentEvents(ctx context.Context) ([]RecentEvent, error) {
	if b.eventLister == nil || !informerSynced(b.eventHasSynced) {
		return []RecentEvent{}, nil
	}
	events, err := b.eventLister.List(labels.Everything())
	if err != nil {
		return nil, err
	}
	return buildRecentEvents(events, ClusterMetaFromContext(ctx)), nil
}

func (b *ClusterOverviewBuilder) clusterOverviewNodeFacts(allowed bool) []nodeOverviewFact {
	if !allowed || b.ingest == nil || !b.ingest.HasSyncedFor(NodeGVR) {
		return nil
	}
	return nodeOverviewFactsFromIngest(b.ingest)
}

func (b *ClusterOverviewBuilder) clusterOverviewPodInputs(allowed bool) ([]streamrows.PodAggregate, uint64) {
	if !allowed {
		return nil, 0
	}
	return podAggregatesFromIngest(b.ingest), podIngestVersion(b.ingest)
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
