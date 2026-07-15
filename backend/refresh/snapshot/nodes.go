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
	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
	"github.com/luxury-yacht/app/backend/refresh/metrics"
	"github.com/luxury-yacht/app/backend/refresh/querypage"
	nodepkg "github.com/luxury-yacht/app/backend/resources/nodes"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/klog/v2"
)

// nodeDomainIngestSource is everything the informer-backed nodes domain still reads from the
// ingest manager AFTER the node OWN-rows moved to the maintained store: the cut pod kind's
// projected aggregation rows (podAggregateIngestSource) and the node store RV for the version
// watermark (nodeIngestSource — only StoreResourceVersion is still read here; the node-sync
// gate stays for the cluster-overview consumer). *ingest.IngestManager satisfies both.
type nodeDomainIngestSource interface {
	nodeIngestSource
	podAggregateIngestSource
}

// NodeBuilder constructs node snapshots from the cut node kind's projected OWN-fields rows
// served straight from a per-cluster maintained store (fed by the node reflector's Table-half
// ingest Sink — same pattern as pods) plus the cut pod kind's projected aggregation rows read
// from the ingest manager, re-joining pod aggregates + metrics onto each node row at serve.
type NodeBuilder struct {
	// maintained is the per-cluster store of node OWN-rows (NodeSummary), fed by the node
	// reflector's Table-half Sink. Build serves own-rows straight from it. nil in a unit test
	// with no store wired, in which case no nodes are served.
	maintained *typedMaintainedStore[NodeSummary]
	// ingest still supplies the per-node pod-aggregate join rows and the node store RV for the
	// version watermark; the node OWN-rows no longer come from here.
	ingest nodeDomainIngestSource
	// metrics supplies the poller usage joined onto the served rows AT SERVE — usage is
	// never written to the maintained store, so a metric tick cannot re-project stored
	// rows. nil (a unit test) serves rows without usage.
	metrics metrics.Provider
	// perBuild reuses the per-Build engine store across page turns/sort flips
	// while the version watermark + metric tick are unchanged (plan P6). The
	// list-fallback builder deliberately passes no cache.
	perBuild *perBuildStoreCache[NodeSummary]
}

// NodeListBuilder assembles node payloads by issuing direct list calls.
type NodeListBuilder struct {
	client  kubernetes.Interface
	metrics metrics.Provider
}

// NodeSnapshot is the payload for the nodes domain. Rows carry live usage joined at
// serve from the metrics poller; Metrics is the poller's freshness/error metadata.
type NodeSnapshot struct {
	ClusterMeta
	ResourceQueryEnvelope
	Rows    []NodeSummary   `json:"rows"`
	Metrics NodeMetricsInfo `json:"metrics"`
}

func nodeQueryCapabilities() ResourceQueryCapabilities {
	return newTypedResourceCapabilities(
		[]string{"name", "kind", "status", "roles", "version", "cpu", "memory", "pods", "restarts", "age"},
		nil,
		[]string{"name", "status", "roles", "version", "internalIP", "externalIP"},
		nil, // no kind filtering
		typedTableFacetDescriptors(nodeQueryFacets())...,
	)
}

func nodeQueryFacets() []typedTableQueryFacet[NodeSummary] {
	return []typedTableQueryFacet[NodeSummary]{
		statusQueryFacet(func(row NodeSummary) string { return row.Status }),
	}
}

// nodesQuerypageSchema derives the querypage Schema for the nodes table from its
// typed-table adapter (reusing the adapter's exact sort encoder + row key), so the
// engine orders rows byte-identically to the live executor. cpu/memory sort the
// live usage joined at serve.
func nodesQuerypageSchema() querypage.Schema[NodeSummary] {
	return querypageSchemaFromAdapter(nodeTableQueryAdapter(), []string{"name", "kind", "status", "roles", "version", "cpu", "memory", "pods", "restarts", "age"})
}

// NodeMetricsInfo captures metadata about metrics collection.
type NodeMetricsInfo struct {
	CollectedAt int64 `json:"collectedAt,omitempty"`
	Stale       bool  `json:"stale"`
	// StaleAfterSeconds ships the staleness threshold so the frontend can flip
	// the stale banner client-side; see PodMetricsInfo.StaleAfterSeconds.
	StaleAfterSeconds   int64  `json:"staleAfterSeconds,omitempty"`
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

// RegisterNodeDomain registers the nodes snapshot domain. Node and pods are both cut to the
// ingest path. The node OWN-rows are served from a per-cluster maintained store fed by the
// node reflector's Table-half ingest Sink — the SAME mechanism pods uses (RegisterPodDomain):
// the bespoke node projector (NewNodeIngestProjector) builds the same OWN-fields NodeSummary
// the maintained store holds, so the served own-rows are byte-identical and the serve-time
// pod-aggregate join is unchanged. The Sink is registered BEFORE the ingest
// manager starts (this runs during registration), so the snapshot sync gate guarantees the
// store is populated before the first Build serves from it. The per-node pod aggregation still
// comes from the ingest manager. ingestManager may be nil in a unit test, in which case the
// store has no feed and no pods are read.
func RegisterNodeDomain(reg *domain.Registry, provider metrics.Provider, clusterMeta ClusterMeta, ingestManager *ingest.IngestManager) error {
	maintained := newTypedMaintainedStore(clusterMeta, nodesQuerypageSchema(), nodeTableQueryAdapter())
	reg.RegisterMaintainedStore("nodes", maintained) // spill/restore/reconcile across Cold/re-warm
	if ingestManager != nil {
		ingestManager.AddBundleSink(NodeGVR, maintained.BundleSink())
	}

	builder := &NodeBuilder{
		maintained: maintained,
		ingest:     ingestManager,
		metrics:    provider,
		perBuild:   &perBuildStoreCache[NodeSummary]{},
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

// Build returns the node snapshot payload. The node OWN-rows and the per-node pod aggregation
// both read the projected rows from ingest (node and pods are cut — no typed listers); the
// per-node pod-aggregate join AND the latest poller usage are re-joined onto each own-row at
// serve. The store rows stay usage-free: a metric tick changes only the served copies and the
// metric source clock, never the object version.
func (b *NodeBuilder) Build(ctx context.Context, scope string) (*refresh.Snapshot, error) {
	nodeUsage, podUsage, metadata := latestNodeMetrics(b.metrics)
	version := nodeDomainIngestVersion(b.ingest)
	return buildNodeSnapshotFromIngestUsage(
		ctx,
		scope,
		b.ownRows(),
		// Two-store watermark (node + pod RVs): the rows join pod aggregates,
		// so pod changes must advance the validator or refetches 304 with
		// stale pod counts.
		version,
		podAggregatesFromIngest(b.ingest),
		nodeUsage,
		podUsage,
		metadata,
		// Reuse the per-Build engine store across page turns/sort flips while
		// the watermark and metric tick (DynamicRevision, in the cache key) are
		// unchanged. The same watermark keys the cache: pod-aggregate changes
		// advance it, so re-joined rows can never serve stale from the cache.
		withPerBuildCache(b.perBuild, strconv.FormatUint(version, 10)),
	)
}

// ownRows returns the node OWN-fields NodeSummary rows from the maintained store (the rows the
// node reflector's Table-half Sink feeds). Nodes are cluster-scoped (no namespace) and the
// store holds the single node kind, so it reads every node row. A nil store (a unit test with
// no store wired) yields no rows.
func (b *NodeBuilder) ownRows() []NodeSummary {
	if b.maintained == nil {
		return nil
	}
	return b.maintained.rows("", map[string]bool{nodepkg.Identity.Kind: true})
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
	// The list fallback projects its typed pods to the same PodAggregate rows the
	// informer path reads from ingest, so the shared aggregation stays byte-equivalent.
	// WorkloadKind is unused by the nodes domain, so a nil RS lister is correct here.
	// Pod RVs fold into the version watermark for the same reason the ingest path
	// folds the pod store RV: pod changes alter served aggregates and must
	// advance the validator.
	aggregates := make([]streamrows.PodAggregate, 0, len(pods))
	var podsVersion uint64
	for _, pod := range pods {
		if pod == nil {
			continue
		}
		aggregates = append(aggregates, projectPodAggregate(pod, PodOwnerSources{}))
		if v := parsePodResourceVersion(pod); v > podsVersion {
			podsVersion = v
		}
	}
	nodeUsage, podUsage, metadata := latestNodeMetrics(b.metrics)
	return buildNodeSnapshotFromUsage(ctx, scope, nodes, aggregates, podsVersion, nodeUsage, podUsage, metadata)
}

// buildNodeSnapshotFromUsage assembles node summaries using pre-resolved
// metrics maps. This is the metrics-as-parameter path required by the
// resource-stream projection contract: stream handlers fetch the usage
// snapshot once and pass it in, so per-event row projection is
// deterministic and tests can use fixture metrics. The pod aggregation reads the
// projected PodAggregate rows (the same rows the typed-pod path produced), so pods is
// never touched here.
func buildNodeSnapshotFromUsage(
	ctx context.Context,
	scope string,
	nodes []*corev1.Node,
	podAggregates []streamrows.PodAggregate,
	// podsVersion is the max RV of the pods the aggregates were projected from;
	// it floors the version watermark so pod-driven aggregate changes advance
	// the validator (0 when the caller has no pod versions, e.g. the
	// single-node stream projection, which never reads the snapshot version).
	podsVersion uint64,
	nodeMetrics map[string]metrics.NodeUsage,
	podMetrics map[string]metrics.PodUsage,
	metricsMetadata metrics.Metadata,
) (*refresh.Snapshot, error) {
	meta := ClusterMetaFromContext(ctx)
	items := make([]NodeSummary, 0, len(nodes))
	version := podsVersion

	podsByNode := podAggregatesByNode(podAggregates)

	for _, node := range nodes {
		if node == nil {
			continue
		}
		// The OWN-fields row (everything read from the node object alone — status, roles,
		// capacity/allocatable, addresses, version, labels, taints, pods-capacity) is built
		// by the SAME builder the ingest projector calls at intake, so the cut path and this
		// serve path produce identical own fields. reaggregateNodeSummary overlays the only
		// serve-side additions — the pod-aggregate join + per-pod/node metrics — re-joined
		// here exactly as before.
		own := buildNodeOwnSummary(meta, node)
		summary := reaggregateNodeSummary(own, podsByNode[node.Name], podMetrics, nodeMetrics)

		items = append(items, summary)
		if v := parseNodeResourceVersion(node); v > version {
			version = v
		}
	}

	return finishNodeSnapshot(ctx, scope, items, version, metricsMetadata)
}

// buildNodeSnapshotFromIngestUsage assembles the node snapshot from the cut node kind's
// projected OWN-fields NodeSummary rows (read from the ingest store) instead of typed nodes.
// It re-joins the per-node pod aggregates + metrics onto each own-row exactly as the typed
// serve loop does, so the resulting rows are byte-identical. The version watermark is the
// ingest store's RV (in place of the per-node RV the dropped typed object no longer carries).
func buildNodeSnapshotFromIngestUsage(
	ctx context.Context,
	scope string,
	ownRows []NodeSummary,
	storeVersion uint64,
	podAggregates []streamrows.PodAggregate,
	nodeMetrics map[string]metrics.NodeUsage,
	podMetrics map[string]metrics.PodUsage,
	metricsMetadata metrics.Metadata,
	opts ...typedServeOption[NodeSummary],
) (*refresh.Snapshot, error) {
	items := make([]NodeSummary, 0, len(ownRows))
	podsByNode := podAggregatesByNode(podAggregates)
	for _, own := range ownRows {
		items = append(items, reaggregateNodeSummary(own, podsByNode[own.Name], podMetrics, nodeMetrics))
	}
	return finishNodeSnapshot(ctx, scope, items, storeVersion, metricsMetadata, opts...)
}

// podAggregatesByNode groups the projected pod aggregates by their NodeName for the per-node
// resource/restart/metric join. An aggregate with no NodeName (an unscheduled pod) is dropped,
// matching the pre-cut loop's `if agg.NodeName != ""` guard.
func podAggregatesByNode(podAggregates []streamrows.PodAggregate) map[string][]streamrows.PodAggregate {
	podsByNode := make(map[string][]streamrows.PodAggregate)
	for _, agg := range podAggregates {
		if agg.NodeName != "" {
			podsByNode[agg.NodeName] = append(podsByNode[agg.NodeName], agg)
		}
	}
	return podsByNode
}

// finishNodeSnapshot is the shared tail both node serve paths (typed list-fallback and ingest)
// run after they assemble the per-node NodeSummary rows + version watermark: it resolves the
// query page and builds the snapshot payload. This is the part of the build that is identical
// regardless of whether the rows came from typed nodes or the ingest store. metricsMetadata is
// the poller sample the rows were joined with: its revision is stamped as the snapshot's
// metric source clock (so a metric tick breaks the 304 validator without moving the object
// Version) and its freshness/error state is published as the payload's Metrics block.
func finishNodeSnapshot(
	ctx context.Context,
	scope string,
	items []NodeSummary,
	version uint64,
	metricsMetadata metrics.Metadata,
	opts ...typedServeOption[NodeSummary],
) (*refresh.Snapshot, error) {
	meta := ClusterMetaFromContext(ctx)
	clusterID, trimmed := refresh.SplitClusterScope(scope)
	revision := metricRevisionFromMetadata(metricsMetadata)
	_, query, err := parseTypedTableQueryScope(clusterID, strings.TrimSpace(trimmed), "nodes", revision)
	if err != nil {
		// Every typed builder rejects a malformed query scope; silently serving
		// default-ordered rows under the requested identity is a contract hole.
		return nil, err
	}

	resolved := resolveTypedSnapshotPageViaStore(
		"nodes",
		items,
		query,
		nodeTableQueryAdapter(),
		nodesQuerypageSchema(),
		nodeQueryCapabilities(),
		config.SnapshotClusterNodesEntryLimit,
		"nodes",
		func(NodeSummary) string { return nodepkg.Identity.Kind },
		nil,
		opts...,
	)
	// The window snapshot is the canonical unscoped refresh payload; only the
	// query page publishes the request scope.
	snapshotScope := ""
	if query.Enabled {
		snapshotScope = refresh.JoinClusterScope(clusterID, strings.TrimSpace(trimmed))
	}
	return &refresh.Snapshot{
		Domain:         "nodes",
		Scope:          snapshotScope,
		Version:        version,
		SourceVersions: metricSourceVersions(revision),
		Payload: NodeSnapshot{
			ClusterMeta:           meta,
			ResourceQueryEnvelope: resolved.Envelope,
			Rows:                  resolved.Rows,
			Metrics:               nodeMetricsInfoFromMetadata(metricsMetadata),
		},
		Stats: resolved.Stats,
	}, nil
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

func aggregatePodResources(pods []streamrows.PodAggregate) (cpuReq, cpuLim, memReq, memLim int64, restarts int32) {
	for _, agg := range pods {
		// Node capacity accounting sums regular AND init container reservations.
		cpuReq += agg.CPURequestMilli + agg.InitCPURequestMilli
		cpuLim += agg.CPULimitMilli + agg.InitCPULimitMilli
		memReq += agg.MemRequestBytes + agg.InitMemRequestBytes
		memLim += agg.MemLimitBytes + agg.InitMemLimitBytes
		// Node restart total counts container + init statuses only (no ephemeral),
		// which RestartCountContainersInit carries.
		restarts += agg.RestartCountContainersInit
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
