package snapshot

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/internal/parallel"
	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/containerlogsstream"
	"github.com/luxury-yacht/app/backend/refresh/domain"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
	"github.com/luxury-yacht/app/backend/refresh/metrics"
	"github.com/luxury-yacht/app/backend/refresh/querypage"
	"github.com/luxury-yacht/app/backend/resources/cronjob"
	"github.com/luxury-yacht/app/backend/resources/daemonset"
	"github.com/luxury-yacht/app/backend/resources/deployment"
	jobres "github.com/luxury-yacht/app/backend/resources/job"
	nodepkg "github.com/luxury-yacht/app/backend/resources/nodes"
	podres "github.com/luxury-yacht/app/backend/resources/pods"
	"github.com/luxury-yacht/app/backend/resources/statefulset"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	informers "k8s.io/client-go/informers"
	"k8s.io/client-go/kubernetes"
	"k8s.io/klog/v2"
)

const (
	podMetricsDomainName                = "pods-metrics"
	namespaceWorkloadsMetricsDomainName = "namespace-workloads-metrics"
	nodeMetricsDomainName               = "nodes-metrics"
)

type PodMetricRow struct {
	ClusterMeta
	Group     string     `json:"group"`
	Version   string     `json:"version"`
	Kind      string     `json:"kind"`
	Resource  string     `json:"resource"`
	Namespace string     `json:"namespace"`
	Name      string     `json:"name"`
	RowKey    string     `json:"rowKey"`
	CPUUsage  string     `json:"cpuUsage"`
	MemUsage  string     `json:"memUsage"`
	base      PodSummary `json:"-"`
}

type PodMetricsSnapshot struct {
	ClusterMeta
	ResourceQueryEnvelope
	Rows    []PodMetricRow `json:"rows"`
	Metrics PodMetricsInfo `json:"metrics"`
}

type NamespaceWorkloadMetricRow struct {
	ClusterMeta
	Group     string          `json:"group"`
	Version   string          `json:"version"`
	Kind      string          `json:"kind"`
	Resource  string          `json:"resource"`
	Namespace string          `json:"namespace"`
	Name      string          `json:"name"`
	RowKey    string          `json:"rowKey"`
	Ready     string          `json:"ready,omitempty"`
	CPUUsage  string          `json:"cpuUsage"`
	MemUsage  string          `json:"memUsage"`
	base      WorkloadSummary `json:"-"`
}

type NamespaceWorkloadMetricsInfo = PodMetricsInfo

type NamespaceWorkloadMetricsSnapshot struct {
	ClusterMeta
	ResourceQueryEnvelope
	Rows    []NamespaceWorkloadMetricRow `json:"rows"`
	Metrics NamespaceWorkloadMetricsInfo `json:"metrics"`
}

type NodeMetricRow struct {
	ClusterMeta
	Group       string          `json:"group"`
	Version     string          `json:"version"`
	Kind        string          `json:"kind"`
	Resource    string          `json:"resource"`
	Name        string          `json:"name"`
	RowKey      string          `json:"rowKey"`
	CPUUsage    string          `json:"cpuUsage"`
	MemoryUsage string          `json:"memoryUsage"`
	PodMetrics  []NodePodMetric `json:"podMetrics,omitempty"`
	base        NodeSummary     `json:"-"`
}

type NodeMetricsSnapshot struct {
	ClusterMeta
	ResourceQueryEnvelope
	Rows    []NodeMetricRow `json:"rows"`
	Metrics NodeMetricsInfo `json:"metrics"`
}

type PodMetricsBuilder struct {
	base    *PodBuilder
	metrics metrics.Provider
}

type NamespaceWorkloadsMetricsBuilder struct {
	base    *NamespaceWorkloadsBuilder
	metrics metrics.Provider
}

type NodeMetricsBuilder struct {
	base       *NodeBuilder
	listClient kubernetes.Interface
	metrics    metrics.Provider
}

func RegisterPodMetricsDomain(reg *domain.Registry, provider metrics.Provider, clusterMeta ClusterMeta, ingestManager *ingest.IngestManager) error {
	maintained := newTypedMaintainedStore(clusterMeta, podQuerypageSchema(), podTableQueryAdapter())
	reg.RegisterMaintainedStore(podMetricsDomainName, maintained)
	if ingestManager != nil {
		ingestManager.AddSink(PodGVR, maintained.Sink())
	}
	base := &PodBuilder{
		projCache:  newPodProjectionCache(),
		maintained: maintained,
	}
	builder := &PodMetricsBuilder{
		base:    base,
		metrics: provider,
	}
	return reg.Register(refresh.DomainConfig{
		Name:          podMetricsDomainName,
		BuildSnapshot: builder.Build,
	})
}

func RegisterNamespaceWorkloadsMetricsDomain(
	reg *domain.Registry,
	factory informers.SharedInformerFactory,
	provider metrics.Provider,
	logger containerlogsstream.Logger,
	perms NamespaceWorkloadsPermissions,
	clusterMeta ClusterMeta,
	ingestManager *ingest.IngestManager,
) error {
	if factory == nil {
		return fmt.Errorf("shared informer factory is nil")
	}
	maintained := newTypedMaintainedStore(clusterMeta, workloadsQuerypageSchema(), workloadTableQueryAdapter())
	feedWorkloadStoreFromIngest(ingestManager, maintained)
	base := &NamespaceWorkloadsBuilder{
		hpaLister:           factory.Autoscaling().V1().HorizontalPodAutoscalers().Lister(),
		workloadIngest:      ingestManager,
		logger:              logger,
		workloadsMaintained: maintained,
		includeDeployments:  perms.IncludeDeployments,
		includeStatefulSets: perms.IncludeStatefulSets,
		includeDaemonSets:   perms.IncludeDaemonSets,
		includeJobs:         perms.IncludeJobs,
		includeCronJobs:     perms.IncludeCronJobs,
	}
	if perms.IncludePods {
		base.podIngest = ingestManager
		base.includePods = true
	}
	reg.RegisterMaintainedStore(namespaceWorkloadsMetricsDomainName, base.workloadsMaintained)
	builder := &NamespaceWorkloadsMetricsBuilder{
		base:    base,
		metrics: provider,
	}
	return reg.Register(refresh.DomainConfig{
		Name:          namespaceWorkloadsMetricsDomainName,
		BuildSnapshot: builder.Build,
	})
}

func RegisterNodeMetricsDomain(reg *domain.Registry, provider metrics.Provider, clusterMeta ClusterMeta, ingestManager *ingest.IngestManager) error {
	maintained := newTypedMaintainedStore(clusterMeta, nodesQuerypageSchema(), nodeTableQueryAdapter())
	reg.RegisterMaintainedStore(nodeMetricsDomainName, maintained)
	if ingestManager != nil {
		ingestManager.AddBundleSink(NodeGVR, maintained.BundleSink())
	}
	base := &NodeBuilder{
		maintained: maintained,
		ingest:     ingestManager,
	}
	builder := &NodeMetricsBuilder{
		base:    base,
		metrics: provider,
	}
	return reg.Register(refresh.DomainConfig{
		Name:          nodeMetricsDomainName,
		BuildSnapshot: builder.Build,
	})
}

func RegisterNodeMetricsDomainList(reg *domain.Registry, client kubernetes.Interface, provider metrics.Provider) error {
	if client == nil {
		return fmt.Errorf("%s: kubernetes client is nil", nodeMetricsDomainName)
	}
	builder := &NodeMetricsBuilder{
		listClient: client,
		metrics:    provider,
	}
	return reg.Register(refresh.DomainConfig{
		Name:          nodeMetricsDomainName,
		BuildSnapshot: builder.Build,
	})
}

func (b *PodMetricsBuilder) Build(ctx context.Context, scope string) (*refresh.Snapshot, error) {
	if b.base == nil {
		return nil, fmt.Errorf("%s: base pods builder is nil", podMetricsDomainName)
	}
	meta := ClusterMetaFromContext(ctx)
	clusterID, trimmed := refresh.SplitClusterScope(scope)
	trimmed = strings.TrimSpace(trimmed)
	if trimmed == "" {
		return nil, fmt.Errorf("pods metrics scope is required")
	}
	podUsage, metadata := latestPodMetrics(b.metrics)
	revision := metricRevisionFromMetadata(metadata)
	baseScope, query, err := parseTypedTableQueryScope(clusterID, trimmed, podMetricsDomainName, revision)
	if err != nil {
		return nil, err
	}
	baseRows, version, err := b.base.collectSummaries(meta, baseScope)
	if err != nil {
		return nil, err
	}
	rows := make([]PodMetricRow, 0, len(baseRows))
	for _, base := range baseRows {
		rows = append(rows, podMetricRowFromSummary(meta, base, podUsage))
	}
	resolved := resolveTypedSnapshotPageViaStore(
		podMetricsDomainName,
		rows,
		query,
		podMetricTableQueryAdapter(),
		podMetricQuerypageSchema(),
		podMetricQueryCapabilities(),
		config.SnapshotNamespacePodsEntryLimit,
		"pods",
		func(PodMetricRow) string { return podres.Identity.Kind },
		nil,
	)
	return &refresh.Snapshot{
		Domain:         podMetricsDomainName,
		Scope:          refresh.JoinClusterScope(clusterID, trimmed),
		Version:        version,
		SourceVersions: metricSourceVersions(revision),
		Payload: PodMetricsSnapshot{
			ClusterMeta:           meta,
			ResourceQueryEnvelope: resolved.Envelope,
			Rows:                  resolved.Rows,
			Metrics:               podMetricsInfoFromMetadata(metadata),
		},
		Stats: resolved.Stats,
	}, nil
}

func (b *NamespaceWorkloadsMetricsBuilder) Build(ctx context.Context, scope string) (*refresh.Snapshot, error) {
	if b.base == nil {
		return nil, fmt.Errorf("%s: base workloads builder is nil", namespaceWorkloadsMetricsDomainName)
	}
	meta := ClusterMetaFromContext(ctx)
	clusterID, trimmed := refresh.SplitClusterScope(scope)
	podUsage, metadata := latestPodMetrics(b.metrics)
	revision := metricRevisionFromMetadata(metadata)
	baseScope, query, err := parseTypedTableQueryScope(clusterID, strings.TrimSpace(trimmed), namespaceWorkloadsMetricsDomainName, revision)
	if err != nil {
		return nil, err
	}
	parsedScope, err := parseNamespaceSnapshotScope(refresh.JoinClusterScope(clusterID, baseScope), errNamespaceScopeRequired)
	if err != nil {
		return nil, err
	}
	namespace := parsedScope.Namespace
	issues := b.base.queryIssuesForDomain(ctx, namespaceWorkloadsMetricsDomainName, query)

	var (
		podAggregates []streamrows.PodAggregate
		podSummaries  map[string]streamrows.PodSummary
	)
	ownRows := b.base.workloadOwnRowsForDomain(ctx, namespaceWorkloadsMetricsDomainName, namespace)
	if b.base.includePods && b.base.podIngest != nil && runtimeResourceAllowed(ctx, namespaceWorkloadsMetricsDomainName, "", "pods") {
		if parsedScope.AllNamespaces {
			podAggregates, podSummaries = workloadOwnerPodRowsFromIngest(b.base.podIngest, ownRows)
		} else {
			podAggregates, podSummaries = namespacePodRowsFromIngest(b.base.podIngest, namespace)
		}
	}
	hpas, hpaErr := b.base.listHPAs(namespace)
	items, version := assembleWorkloadRows(
		meta,
		podAggregates,
		podSummaries,
		ownRows,
		hpas,
		hpaErr == nil,
		podUsage,
		namespaceWorkloadIngestVersion(b.base.workloadIngest, DeploymentGVR, StatefulSetGVR, DaemonSetGVR, JobGVR, CronJobGVR),
		namespacePodIngestVersion(b.base.podIngest),
	)
	rows := make([]NamespaceWorkloadMetricRow, 0, len(items))
	for _, item := range items {
		rows = append(rows, workloadMetricRowFromSummary(meta, item))
	}
	resolved := resolveTypedSnapshotPageViaStore(
		namespaceWorkloadsMetricsDomainName,
		rows,
		query,
		workloadMetricTableQueryAdapter(),
		workloadMetricQuerypageSchema(),
		workloadMetricQueryCapabilities(b.base),
		config.SnapshotNamespaceWorkloadsEntryLimit,
		"workloads",
		func(r NamespaceWorkloadMetricRow) string { return r.Kind },
		issues,
	)
	return &refresh.Snapshot{
		Domain:         namespaceWorkloadsMetricsDomainName,
		Scope:          refresh.JoinClusterScope(clusterID, strings.TrimSpace(trimmed)),
		Version:        version,
		SourceVersions: metricSourceVersions(revision),
		Payload: NamespaceWorkloadMetricsSnapshot{
			ClusterMeta:           meta,
			ResourceQueryEnvelope: resolved.Envelope,
			Rows:                  resolved.Rows,
			Metrics:               podMetricsInfoFromMetadata(metadata),
		},
		Stats: resolved.Stats,
	}, nil
}

func (b *NodeMetricsBuilder) Build(ctx context.Context, scope string) (*refresh.Snapshot, error) {
	meta := ClusterMetaFromContext(ctx)
	clusterID, trimmed := refresh.SplitClusterScope(scope)
	nodeUsage, podUsage, metadata := latestNodeMetrics(b.metrics)
	revision := metricRevisionFromMetadata(metadata)
	_, query, err := parseTypedTableQueryScope(clusterID, strings.TrimSpace(trimmed), nodeMetricsDomainName, revision)
	if err != nil {
		return nil, err
	}
	baseRows, version, err := b.nodeMetricBaseRows(ctx, meta, nodeUsage, podUsage)
	if err != nil {
		return nil, err
	}
	rows := make([]NodeMetricRow, 0, len(baseRows))
	for _, base := range baseRows {
		rows = append(rows, nodeMetricRowFromSummary(meta, base))
	}
	resolved := resolveTypedSnapshotPageViaStore(
		nodeMetricsDomainName,
		rows,
		query,
		nodeMetricTableQueryAdapter(),
		nodeMetricQuerypageSchema(),
		nodeMetricQueryCapabilities(),
		config.SnapshotClusterNodesEntryLimit,
		"nodes",
		func(NodeMetricRow) string { return nodepkg.Identity.Kind },
		nil,
	)
	snapshotScope := ""
	if query.Enabled {
		snapshotScope = refresh.JoinClusterScope(clusterID, strings.TrimSpace(trimmed))
	}
	return &refresh.Snapshot{
		Domain:         nodeMetricsDomainName,
		Scope:          snapshotScope,
		Version:        version,
		SourceVersions: metricSourceVersions(revision),
		Payload: NodeMetricsSnapshot{
			ClusterMeta:           meta,
			ResourceQueryEnvelope: resolved.Envelope,
			Rows:                  resolved.Rows,
			Metrics:               nodeMetricsInfoFromMetadata(metadata),
		},
		Stats: resolved.Stats,
	}, nil
}

func (b *NodeMetricsBuilder) nodeMetricBaseRows(ctx context.Context, meta ClusterMeta, nodeUsage map[string]metrics.NodeUsage, podUsage map[string]metrics.PodUsage) ([]NodeSummary, uint64, error) {
	if b.base != nil {
		ownRows := b.base.ownRows()
		podsByNode := podAggregatesByNode(podAggregatesFromIngest(b.base.ingest))
		rows := make([]NodeSummary, 0, len(ownRows))
		for _, own := range ownRows {
			rows = append(rows, reaggregateNodeSummary(own, podsByNode[own.Name], podUsage, nodeUsage))
		}
		return rows, nodeIngestVersion(b.base.ingest), nil
	}
	nodes, aggregates, version, err := collectNodeListMetricInputs(ctx, b.listClient)
	if err != nil {
		return nil, 0, err
	}
	rows := make([]NodeSummary, 0, len(nodes))
	podsByNode := podAggregatesByNode(aggregates)
	for _, node := range nodes {
		if node == nil {
			continue
		}
		own := buildNodeOwnSummary(meta, node)
		rows = append(rows, reaggregateNodeSummary(own, podsByNode[node.Name], podUsage, nodeUsage))
	}
	return rows, version, nil
}

func collectNodeListMetricInputs(ctx context.Context, client kubernetes.Interface) ([]*corev1.Node, []streamrows.PodAggregate, uint64, error) {
	if client == nil {
		return nil, nil, 0, fmt.Errorf("%s: kubernetes client is nil", nodeMetricsDomainName)
	}
	var (
		nodes         []*corev1.Node
		pods          []*corev1.Pod
		podsForbidden bool
		mu            sync.Mutex
	)
	tasks := []func(context.Context) error{
		func(ctx context.Context) error {
			resp, err := client.CoreV1().Nodes().List(ctx, metav1.ListOptions{})
			if err != nil {
				return err
			}
			mu.Lock()
			nodes = parallel.CopyToPointers(resp.Items)
			mu.Unlock()
			return nil
		},
		func(ctx context.Context) error {
			resp, err := client.CoreV1().Pods("").List(ctx, metav1.ListOptions{})
			switch {
			case err == nil:
				mu.Lock()
				pods = parallel.CopyToPointers(resp.Items)
				mu.Unlock()
				return nil
			case apierrors.IsForbidden(err):
				klog.V(2).Info("nodes metrics snapshot: pod list forbidden; rendering node metrics without per-pod rows")
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
		return nil, nil, 0, err
	}
	if podsForbidden {
		pods = nil
	}
	aggregates := make([]streamrows.PodAggregate, 0, len(pods))
	for _, pod := range pods {
		if pod == nil {
			continue
		}
		aggregates = append(aggregates, projectPodAggregate(pod, nil))
	}
	var version uint64
	for _, node := range nodes {
		if v := parseNodeResourceVersion(node); v > version {
			version = v
		}
	}
	return nodes, aggregates, version, nil
}

func podMetricRowFromSummary(meta ClusterMeta, base PodSummary, podUsage map[string]metrics.PodUsage) PodMetricRow {
	usage, ok := podUsage[base.Namespace+"/"+base.Name]
	return PodMetricRow{
		ClusterMeta: meta,
		Group:       podres.Identity.Group,
		Version:     podres.Identity.Version,
		Kind:        podres.Identity.Kind,
		Resource:    podres.Identity.Resource,
		Namespace:   base.Namespace,
		Name:        base.Name,
		RowKey:      podTableQueryAdapter().Key(base),
		CPUUsage:    formatPodMetricCPU(usage, ok, base.AgeTimestamp),
		MemUsage:    formatPodMetricMemory(usage, ok, base.AgeTimestamp),
		base:        base,
	}
}

func workloadMetricRowFromSummary(meta ClusterMeta, base WorkloadSummary) NamespaceWorkloadMetricRow {
	group, version, resource := workloadIdentityParts(base.Kind)
	return NamespaceWorkloadMetricRow{
		ClusterMeta: meta,
		Group:       group,
		Version:     version,
		Kind:        base.Kind,
		Resource:    resource,
		Namespace:   base.Namespace,
		Name:        base.Name,
		RowKey:      workloadTableQueryAdapter().Key(base),
		Ready:       base.Ready,
		CPUUsage:    base.CPUUsage,
		MemUsage:    base.MemUsage,
		base:        base,
	}
}

func nodeMetricRowFromSummary(meta ClusterMeta, base NodeSummary) NodeMetricRow {
	return NodeMetricRow{
		ClusterMeta: meta,
		Group:       nodepkg.Identity.Group,
		Version:     nodepkg.Identity.Version,
		Kind:        nodepkg.Identity.Kind,
		Resource:    nodepkg.Identity.Resource,
		Name:        base.Name,
		RowKey:      nodeTableQueryAdapter().Key(base),
		CPUUsage:    base.CPUUsage,
		MemoryUsage: base.MemoryUsage,
		PodMetrics:  append([]NodePodMetric(nil), base.PodMetrics...),
		base:        base,
	}
}

func workloadIdentityParts(kind string) (group, version, resource string) {
	switch kind {
	case podres.Identity.Kind:
		return podres.Identity.Group, podres.Identity.Version, podres.Identity.Resource
	case deployment.Identity.Kind:
		return deployment.Identity.Group, deployment.Identity.Version, deployment.Identity.Resource
	case statefulset.Identity.Kind:
		return statefulset.Identity.Group, statefulset.Identity.Version, statefulset.Identity.Resource
	case daemonset.Identity.Kind:
		return daemonset.Identity.Group, daemonset.Identity.Version, daemonset.Identity.Resource
	case jobres.Identity.Kind:
		return jobres.Identity.Group, jobres.Identity.Version, jobres.Identity.Resource
	case cronjob.Identity.Kind:
		return cronjob.Identity.Group, cronjob.Identity.Version, cronjob.Identity.Resource
	default:
		return "", "v1", strings.ToLower(kind) + "s"
	}
}

func podMetricQueryCapabilities() ResourceQueryCapabilities {
	return newTypedResourceCapabilities(
		[]string{"name", "namespace", "status", "ready", "restarts", "owner", "node", "cpu", "memory", "age"},
		[]string{"kinds", "namespaces", "statuses", "nodes"},
		[]string{"name", "namespace", "status", "ready", "owner", "node"},
		[]string{podres.Identity.Kind},
	)
}

func podMetricQuerypageSchema() querypage.Schema[PodMetricRow] {
	return querypageSchemaFromAdapter(
		podMetricTableQueryAdapter(),
		[]string{"name", "namespace", "status", "ready", "restarts", "owner", "node", "cpu", "memory", "age"},
	)
}

func podMetricTableQueryAdapter() typedTableQueryAdapter[PodMetricRow] {
	baseAdapter := podTableQueryAdapter()
	return typedTableQueryAdapter[PodMetricRow]{
		Key:        func(row PodMetricRow) string { return row.RowKey },
		Namespace:  func(row PodMetricRow) string { return row.Namespace },
		Kind:       func(PodMetricRow) string { return podres.Identity.Kind },
		SearchText: func(row PodMetricRow) []string { return baseAdapter.SearchText(row.base) },
		MetadataText: func(row PodMetricRow) []string {
			if baseAdapter.MetadataText == nil {
				return nil
			}
			return baseAdapter.MetadataText(row.base)
		},
		Predicate: func(row PodMetricRow, field, value string) bool {
			if strings.EqualFold(strings.TrimSpace(field), "rowKeys") {
				return rowKeyPredicateMatches(value, row.RowKey)
			}
			return baseAdapter.Predicate(row.base, field, value)
		},
		SortValue: func(row PodMetricRow, field string) string {
			switch strings.ToLower(field) {
			case "cpu":
				return row.CPUUsage
			case "memory":
				return row.MemUsage
			default:
				return baseAdapter.SortValue(row.base, field)
			}
		},
		NumericSort: func(row PodMetricRow, field string) (float64, bool) {
			switch strings.ToLower(field) {
			case "cpu":
				return parseFormattedCPUToMilli(row.CPUUsage)
			case "memory":
				return parseFormattedMemoryToBytes(row.MemUsage)
			default:
				return baseAdapter.NumericSort(row.base, field)
			}
		},
	}
}

func workloadMetricQueryCapabilities(builder *NamespaceWorkloadsBuilder) ResourceQueryCapabilities {
	if builder == nil {
		return namespaceWorkloadsMetricCapabilities()
	}
	return capabilitiesWithAvailableKinds(namespaceWorkloadsMetricCapabilities(), builder.resourceSources())
}

func namespaceWorkloadsMetricCapabilities() ResourceQueryCapabilities {
	return namespaceWorkloadsMetricQueryCapabilities()
}

func namespaceWorkloadsMetricQueryCapabilities() ResourceQueryCapabilities {
	return newTypedResourceCapabilities(
		[]string{"name", "kind", "namespace", "status", "ready", "restarts", "cpu", "memory", "age"},
		[]string{"kinds", "namespaces"},
		[]string{"kind", "name", "namespace", "status", "ready"},
		[]string{podres.Identity.Kind, deployment.Identity.Kind, statefulset.Identity.Kind, daemonset.Identity.Kind, jobres.Identity.Kind, cronjob.Identity.Kind},
	)
}

func workloadMetricQuerypageSchema() querypage.Schema[NamespaceWorkloadMetricRow] {
	return querypageSchemaFromAdapter(
		workloadMetricTableQueryAdapter(),
		[]string{"name", "kind", "namespace", "status", "ready", "restarts", "cpu", "memory", "age"},
	)
}

func workloadMetricTableQueryAdapter() typedTableQueryAdapter[NamespaceWorkloadMetricRow] {
	baseAdapter := workloadTableQueryAdapter()
	return typedTableQueryAdapter[NamespaceWorkloadMetricRow]{
		Key:        func(row NamespaceWorkloadMetricRow) string { return row.RowKey },
		Namespace:  func(row NamespaceWorkloadMetricRow) string { return row.Namespace },
		Kind:       func(row NamespaceWorkloadMetricRow) string { return row.Kind },
		SearchText: func(row NamespaceWorkloadMetricRow) []string { return baseAdapter.SearchText(row.base) },
		MetadataText: func(row NamespaceWorkloadMetricRow) []string {
			if baseAdapter.MetadataText == nil {
				return nil
			}
			return baseAdapter.MetadataText(row.base)
		},
		Predicate: func(row NamespaceWorkloadMetricRow, field, value string) bool {
			if strings.EqualFold(strings.TrimSpace(field), "rowKeys") {
				return rowKeyPredicateMatches(value, row.RowKey)
			}
			return baseAdapter.Predicate(row.base, field, value)
		},
		SortValue: func(row NamespaceWorkloadMetricRow, field string) string {
			switch strings.ToLower(field) {
			case "cpu":
				return row.CPUUsage
			case "memory":
				return row.MemUsage
			default:
				return baseAdapter.SortValue(row.base, field)
			}
		},
		NumericSort: func(row NamespaceWorkloadMetricRow, field string) (float64, bool) {
			switch strings.ToLower(field) {
			case "cpu":
				return parseFormattedCPUToMilli(row.CPUUsage)
			case "memory":
				return parseFormattedMemoryToBytes(row.MemUsage)
			default:
				return baseAdapter.NumericSort(row.base, field)
			}
		},
	}
}

func nodeMetricQueryCapabilities() ResourceQueryCapabilities {
	return newTypedResourceCapabilities(
		[]string{"name", "kind", "status", "roles", "version", "cpu", "memory", "pods", "restarts", "age"},
		nil,
		[]string{"name", "status", "roles", "version", "internalIP", "externalIP"},
		nil,
	)
}

func nodeMetricQuerypageSchema() querypage.Schema[NodeMetricRow] {
	return querypageSchemaFromAdapter(nodeMetricTableQueryAdapter(), []string{"name", "kind", "status", "roles", "version", "cpu", "memory", "pods", "restarts", "age"})
}

func nodeMetricTableQueryAdapter() typedTableQueryAdapter[NodeMetricRow] {
	baseAdapter := nodeTableQueryAdapter()
	return typedTableQueryAdapter[NodeMetricRow]{
		Key:        func(row NodeMetricRow) string { return row.RowKey },
		Namespace:  func(NodeMetricRow) string { return "" },
		Kind:       func(NodeMetricRow) string { return nodepkg.Identity.Kind },
		SearchText: func(row NodeMetricRow) []string { return baseAdapter.SearchText(row.base) },
		MetadataText: func(row NodeMetricRow) []string {
			if baseAdapter.MetadataText == nil {
				return nil
			}
			return baseAdapter.MetadataText(row.base)
		},
		Predicate: func(row NodeMetricRow, field, value string) bool {
			if strings.EqualFold(strings.TrimSpace(field), "rowKeys") {
				return rowKeyPredicateMatches(value, row.RowKey)
			}
			return baseAdapter.Predicate(row.base, field, value)
		},
		SortValue: func(row NodeMetricRow, field string) string {
			switch strings.ToLower(field) {
			case "cpu", "cpuusage":
				return row.CPUUsage
			case "memory", "memoryusage":
				return row.MemoryUsage
			default:
				return baseAdapter.SortValue(row.base, field)
			}
		},
		NumericSort: func(row NodeMetricRow, field string) (float64, bool) {
			switch strings.ToLower(field) {
			case "cpu", "cpuusage":
				return parseFormattedCPUToMilli(row.CPUUsage)
			case "memory", "memoryusage":
				return parseFormattedMemoryToBytes(row.MemoryUsage)
			default:
				return baseAdapter.NumericSort(row.base, field)
			}
		},
	}
}

func latestPodMetrics(provider metrics.Provider) (map[string]metrics.PodUsage, metrics.Metadata) {
	if provider == nil {
		return map[string]metrics.PodUsage{}, metrics.Metadata{}
	}
	return podUsageOrEmpty(provider.LatestPodUsage()), provider.Metadata()
}

func latestNodeMetrics(provider metrics.Provider) (map[string]metrics.NodeUsage, map[string]metrics.PodUsage, metrics.Metadata) {
	if provider == nil {
		return map[string]metrics.NodeUsage{}, map[string]metrics.PodUsage{}, metrics.Metadata{}
	}
	return nodeUsageOrEmpty(provider.LatestNodeUsage()), podUsageOrEmpty(provider.LatestPodUsage()), provider.Metadata()
}

func metricRevisionFromMetadata(metadata metrics.Metadata) string {
	if metadata.CollectedAt.IsZero() {
		return ""
	}
	return strconv.FormatInt(metadata.CollectedAt.UnixNano(), 10)
}

func podMetricsInfoFromMetadata(metadata metrics.Metadata) PodMetricsInfo {
	info := PodMetricsInfo{
		Stale:               true,
		LastError:           metadata.LastError,
		ConsecutiveFailures: metadata.ConsecutiveFailures,
		SuccessCount:        metadata.SuccessCount,
		FailureCount:        metadata.FailureCount,
	}
	if !metadata.CollectedAt.IsZero() {
		info.CollectedAt = metadata.CollectedAt.Unix()
		info.Stale = time.Since(metadata.CollectedAt) > config.MetricsStaleThreshold
	}
	return info
}

func nodeMetricsInfoFromMetadata(metadata metrics.Metadata) NodeMetricsInfo {
	info := NodeMetricsInfo{
		Stale:               true,
		LastError:           metadata.LastError,
		ConsecutiveFailures: metadata.ConsecutiveFailures,
		SuccessCount:        metadata.SuccessCount,
		FailureCount:        metadata.FailureCount,
	}
	if !metadata.CollectedAt.IsZero() {
		info.CollectedAt = metadata.CollectedAt.Unix()
		info.Stale = time.Since(metadata.CollectedAt) > config.MetricsStaleThreshold
	}
	return info
}

func rowKeyPredicateMatches(raw string, rowKey string) bool {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return true
	}
	rowKey = strings.ToLower(strings.TrimSpace(rowKey))
	for _, candidate := range strings.Split(raw, "|") {
		if strings.ToLower(strings.TrimSpace(candidate)) == rowKey {
			return true
		}
	}
	return false
}
