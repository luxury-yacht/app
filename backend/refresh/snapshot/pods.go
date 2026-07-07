package snapshot

import (
	"context"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	deploymentpkg "github.com/luxury-yacht/app/backend/resources/deployment"
	podres "github.com/luxury-yacht/app/backend/resources/pods"
	replicasetpkg "github.com/luxury-yacht/app/backend/resources/replicaset"

	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/labels"
	"k8s.io/apimachinery/pkg/runtime/schema"
	appslisters "k8s.io/client-go/listers/apps/v1"
	corelisters "k8s.io/client-go/listers/core/v1"
	"k8s.io/client-go/tools/cache"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
	"github.com/luxury-yacht/app/backend/refresh/metrics"
	"github.com/luxury-yacht/app/backend/refresh/querypage"
	"github.com/luxury-yacht/app/backend/resources/common"
)

// PodBuilder constructs pod snapshots scoped by node or workload.
type PodBuilder struct {
	podLister  corelisters.PodLister
	podIndexer cache.Indexer
	rsLister   appslisters.ReplicaSetLister
	// buildSummary projects a pod into its row. It is a field so tests can count
	// or inject projections; nil defaults to podres.BuildStreamSummaryFromRSMap.
	buildSummary func(ClusterMeta, *corev1.Pod, int64, int64, map[string]string) PodSummary
	// projCache memoizes projected rows so the frequent refetches a busy cluster
	// drives reuse work instead of re-projecting every pod each request. nil for
	// ad-hoc/test builders (projection runs directly).
	projCache *podProjectionCache
	// maintained, when set, is an informer-fed store of pod rows. Namespace,
	// node, and workload scopes serve rows straight from it; nil falls back to
	// the list path used by older unit tests.
	maintained *typedMaintainedStore[PodSummary]
	// metrics supplies the poller usage joined onto the served rows AT SERVE — usage
	// is never written to the maintained store or the projection cache, so a metric
	// tick cannot re-project stored rows. nil (a unit test) serves the no-data marker.
	metrics metrics.Provider
	// perBuild reuses the per-Build engine store across page turns/sort flips
	// while the object version + metric tick are unchanged (plan P6). Per-cluster
	// (owned by this builder), dropped with it on teardown.
	perBuild *perBuildStoreCache[PodSummary]
}

// newPodBuilder wires a PodBuilder with the projection memo cache enabled.
func newPodBuilder(podLister corelisters.PodLister, podIndexer cache.Indexer, rsLister appslisters.ReplicaSetLister) *PodBuilder {
	return &PodBuilder{
		podLister:  podLister,
		podIndexer: podIndexer,
		rsLister:   rsLister,
		projCache:  newPodProjectionCache(),
	}
}

func (b *PodBuilder) projectPod(meta ClusterMeta, pod *corev1.Pod, rsMap map[string]string) PodSummary {
	build := func() PodSummary {
		project := b.buildSummary
		if project == nil {
			project = podres.BuildStreamSummaryFromRSMap
		}
		return project(meta, pod, 0, 0, rsMap)
	}
	var summary PodSummary
	if b.projCache == nil {
		summary = build()
	} else {
		summary = b.projCache.summaryFor(string(pod.UID), pod.ResourceVersion, build)
	}
	return podSummaryWithoutMetrics(summary)
}

func podSummaryWithoutMetrics(summary PodSummary) PodSummary {
	summary.CPUUsage = streamrows.MetricsNoData
	summary.MemUsage = streamrows.MetricsNoData
	return summary
}

// podProjectionCacheTTL bounds the memo cache: entries for pods not seen within
// the window (e.g. deleted pods) are evicted, so it stays bounded without any
// informer-event wiring.
const podProjectionCacheTTL = 2 * time.Minute

type podProjectionEntry struct {
	resourceVersion string
	summary         PodSummary
	lastAccess      time.Time
}

// podProjectionCache memoizes pod OBJECT row projections keyed by pod UID. A
// summary is reused while the pod's resourceVersion is unchanged: a pod change
// bumps RV, and the RS->Deployment owner is immutable in practice, so RV fully
// determines the object projection.
type podProjectionCache struct {
	mu        sync.Mutex
	entries   map[string]podProjectionEntry
	lastPrune time.Time
}

func newPodProjectionCache() *podProjectionCache {
	return &podProjectionCache{entries: make(map[string]podProjectionEntry)}
}

// summaryFor returns the cached object projection on a resourceVersion hit,
// otherwise builds, stores, and returns a fresh one. build() runs outside the
// lock so concurrent scope builds don't serialize on projection; a concurrent
// miss re-projects once (identical result, last write wins).
func (c *podProjectionCache) summaryFor(uid, resourceVersion string, build func() PodSummary) PodSummary {
	now := time.Now()
	c.mu.Lock()
	if entry, ok := c.entries[uid]; ok && entry.resourceVersion == resourceVersion {
		entry.lastAccess = now
		c.entries[uid] = entry
		c.mu.Unlock()
		return entry.summary
	}
	c.mu.Unlock()

	summary := build()

	c.mu.Lock()
	c.entries[uid] = podProjectionEntry{
		resourceVersion: resourceVersion,
		summary:         summary,
		lastAccess:      now,
	}
	c.mu.Unlock()
	return summary
}

// prune evicts entries not accessed within the TTL, at most once per window.
func (c *podProjectionCache) prune(now time.Time) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if now.Sub(c.lastPrune) < podProjectionCacheTTL {
		return
	}
	c.lastPrune = now
	for uid, entry := range c.entries {
		if now.Sub(entry.lastAccess) > podProjectionCacheTTL {
			delete(c.entries, uid)
		}
	}
}

// PodSnapshot is the payload for the pods domain. Rows carry live usage joined at
// serve from the metrics poller; Metrics is the poller's freshness/error metadata.
type PodSnapshot struct {
	ClusterMeta
	ResourceQueryEnvelope
	Rows    []PodSummary   `json:"rows"`
	Metrics PodMetricsInfo `json:"metrics"`
	// TotalCount is the number of pods in the requested scope (before search/
	// pagination). HealthCounts holds the per-filter-mode counts (keys match the
	// "health" query predicate: "unhealthy", "restarts", "not-ready"). Together
	// they let a query-backed view show total/unhealthy badges and decide whether
	// a pending health filter has matches — without retaining the live row set.
	// See docs/architecture/resource-stream-signals.md.
	TotalCount   int            `json:"totalCount"`
	HealthCounts map[string]int `json:"healthCounts"`
}

// podHealthFilterModes are the "health" predicate values whose scope counts the
// frontend needs (badge + pending-filter restore). Counting via the predicate
// keeps each count consistent with the filter it gates.
var podHealthFilterModes = []string{"unhealthy", "restarts", "not-ready"}

// podSummaryUnhealthy reports whether a pod row should count as unhealthy. It is
// the single source for the "unhealthy" notion shared by the scope count and the
// "show unhealthy" query predicate, so the badge and the filter stay consistent.
func podSummaryUnhealthy(pod PodSummary) bool {
	presentation := strings.ToLower(strings.TrimSpace(pod.StatusPresentation))
	return presentation == "warning" || presentation == "error" ||
		presentation == "not-ready" || presentation == "terminating"
}

func podQueryCapabilities() ResourceQueryCapabilities {
	return newTypedResourceCapabilities(
		[]string{"name", "namespace", "status", "ready", "restarts", "owner", "node", "cpu", "memory", "age"},
		[]string{"kinds", "namespaces", "statuses", "nodes"},
		[]string{"name", "namespace", "status", "ready", "owner", "node"},
		[]string{podres.Identity.Kind},
	)
}

// podQuerypageSchema derives the querypage Schema for the pods table from its
// typed-table adapter, reusing the adapter's exact sort-value encoder and row key so
// the engine orders rows byte-identically to the live executor. The sort fields
// mirror the sortable fields published by podQueryCapabilities; cpu/memory sort the
// live usage joined at serve.
func podQuerypageSchema() querypage.Schema[PodSummary] {
	return querypageSchemaFromAdapter(
		podTableQueryAdapter(),
		[]string{"name", "namespace", "status", "ready", "restarts", "owner", "node", "cpu", "memory", "age"},
	)
}

// PodSummary lives in the streamrows leaf so the pods package can build it; this
// alias keeps the snapshot-side name and wire JSON unchanged.
type PodSummary = streamrows.PodSummary

// PodMetricsInfo mirrors metrics poller metadata for pods.
type PodMetricsInfo struct {
	CollectedAt int64 `json:"collectedAt,omitempty"`
	Stale       bool  `json:"stale"`
	// StaleAfterSeconds ships the staleness threshold so the frontend can flip
	// the stale banner client-side: the poller rings no doorbell on failure, so
	// on a quiet cluster nothing refetches to refresh a server-computed Stale.
	StaleAfterSeconds   int64  `json:"staleAfterSeconds,omitempty"`
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
//
// Pods is an owned-reflector ingest kind (IngestOwned): the typed pod informer is
// never instantiated. The per-cluster maintained store of pod rows
// is fed by the pod reflector's Table-half ingest Sink — the bespoke pod projector
// (NewPodIngestProjector) builds the same object-state PodSummary the old informer
// handler did, so the store rows are byte-identical. With no typed lister, the builder serves EVERY
// scope (namespace/node/workload) from the store rows, which carry the resolved Node
// and owner the scope filters need. ingestManager may be nil in a unit test, in which
// case the store has no feed.
func RegisterPodDomain(reg *domain.Registry, provider metrics.Provider, clusterMeta ClusterMeta, ingestManager *ingest.IngestManager) error {
	// Maintain a per-cluster store of pod rows, fed by the pod
	// reflector's Table-half Sink. The sink is registered BEFORE the ingest manager
	// starts (this runs during registration), so the snapshot sync gate guarantees the
	// store is populated before the first Build serves from it.
	maintained := newTypedMaintainedStore(clusterMeta, podQuerypageSchema(), podTableQueryAdapter())
	reg.RegisterMaintainedStore(podDomainName, maintained) // spill/restore/reconcile across Cold/re-warm
	if ingestManager != nil {
		ingestManager.AddSink(PodGVR, maintained.Sink())
	}

	builder := &PodBuilder{
		projCache:  newPodProjectionCache(),
		maintained: maintained,
		metrics:    provider,
		perBuild:   &perBuildStoreCache[PodSummary]{},
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

	podUsage, metricsMetadata := latestPodMetrics(b.metrics)
	revision := metricRevisionFromMetadata(metricsMetadata)
	baseScope, query, err := parseTypedTableQueryScope(clusterID, trimmed, podDomainName, revision)
	if err != nil {
		return nil, err
	}

	summaries, version, err := b.collectSummaries(meta, baseScope)
	if err != nil {
		return nil, err
	}
	// Join the latest poller usage onto the served copies. The maintained store's
	// rows keep the no-data marker: a metric tick changes only this serve output
	// and the metric source clock, never the stored rows or the object version.
	overlayPodMetrics(summaries, podUsage)

	adapter := podTableQueryAdapter()
	totalCount := 0
	healthCounts := map[string]int{}
	for _, summary := range summaries {
		totalCount++
		for _, mode := range podHealthFilterModes {
			if adapter.Predicate(summary, "health", mode) {
				healthCounts[mode]++
			}
		}
	}

	// Pre-sort by (namespace, name) ONLY for the window branch, which truncates
	// input order. The query branch re-sorts via the engine and ignores this
	// order — sorting the full scope there is wasted work on every doorbell
	// refetch (pinned by TestPodBuilderWindowScopeOrdersRowsByNamespaceThenName).
	if !query.Enabled {
		sort.Slice(summaries, func(i, j int) bool {
			if summaries[i].Namespace == summaries[j].Namespace {
				return summaries[i].Name < summaries[j].Name
			}
			return summaries[i].Namespace < summaries[j].Namespace
		})
	}

	// Serve the query branch through the querypage engine (proven byte-equivalent to
	// the bespoke typed-table executor in querypage_pods_test.go); the window branch
	// and all envelope wiring are unchanged.
	resolved := resolveTypedSnapshotPageViaStore(
		podDomainName,
		summaries,
		query,
		adapter,
		podQuerypageSchema(),
		podQueryCapabilities(),
		config.SnapshotNamespacePodsEntryLimit,
		"pods",
		func(PodSummary) string { return podres.Identity.Kind },
		nil,
		// Reuse the per-Build engine store across page turns/sort flips while the
		// object version and metric tick (DynamicRevision, inside the cache key)
		// are unchanged.
		withPerBuildCache(b.perBuild, strconv.FormatUint(version, 10)),
	)

	snapshot := &refresh.Snapshot{
		Domain:         podDomainName,
		Scope:          refresh.JoinClusterScope(clusterID, trimmed),
		Version:        version,
		SourceVersions: metricSourceVersions(revision),
		Payload: PodSnapshot{
			ClusterMeta:           meta,
			ResourceQueryEnvelope: resolved.Envelope,
			Rows:                  resolved.Rows,
			Metrics:               podMetricsInfoFromMetadata(metricsMetadata),
			TotalCount:            totalCount,
			HealthCounts:          healthCounts,
		},
		Stats: resolved.Stats,
	}

	return snapshot, nil
}

// collectSummaries returns the in-scope pod rows and the snapshot version. When the
// builder has no typed pod lister (the production, ingest-fed path) every scope —
// namespace, node, and workload — is served straight from the maintained store. The
// store rows carry the resolved Node and owner the node/workload scopes filter by.
func (b *PodBuilder) collectSummaries(meta ClusterMeta, baseScope string) ([]PodSummary, uint64, error) {
	if b.podLister == nil && b.maintained != nil {
		return b.collectSummariesFromStore(baseScope)
	}
	if namespace, ok := podStoreServableNamespace(baseScope); ok && b.maintained != nil {
		rows := b.maintained.rows(namespace, map[string]bool{podres.Identity.Kind: true})
		return rows, b.maintained.snapshotVersion(), nil
	}

	pods, err := b.collectPods(baseScope)
	if err != nil {
		return nil, 0, err
	}
	if b.projCache != nil {
		b.projCache.prune(time.Now())
	}
	rsMap, err := b.replicasetDeploymentMap(pods)
	if err != nil {
		return nil, 0, err
	}
	summaries := make([]PodSummary, 0, len(pods))
	var version uint64
	for _, pod := range pods {
		if pod == nil {
			continue
		}
		summaries = append(summaries, b.projectPod(meta, pod, rsMap))
		if v := parsePodResourceVersion(pod); v > version {
			version = v
		}
	}
	return summaries, version, nil
}

// collectSummariesFromStore serves any pod scope from the maintained store's rows
// (the ingest-fed, no-typed-lister production path). It filters the stored rows by
// the scope (namespace / node / workload) and returns the store's monotonic snapshot
// version. The filters read only the resolved fields the rows already carry — Node for
// the node scope, the RS->Deployment-resolved owner for the workload scope — so the
// result matches the typed-lister list path.
func (b *PodBuilder) collectSummariesFromStore(baseScope string) ([]PodSummary, uint64, error) {
	all := b.maintained.rows("", map[string]bool{podres.Identity.Kind: true})
	rows, err := filterPodRowsByScope(all, baseScope)
	if err != nil {
		return nil, 0, err
	}
	return rows, b.maintained.snapshotVersion(), nil
}

// filterPodRowsByScope returns the subset of store rows in the requested scope. It
// mirrors collectPods' scope parsing, but matches against the rows' already-resolved
// fields instead of a typed pod: the node scope filters by Node, the workload scope by
// the resolved owner GVK+name, and the namespace scope by Namespace (all/* = every
// namespace).
func filterPodRowsByScope(rows []PodSummary, scope string) ([]PodSummary, error) {
	parts := strings.SplitN(scope, ":", 2)
	if len(parts) != 2 {
		return nil, fmt.Errorf("invalid pods scope: %s", scope)
	}
	scopeKey, value := parts[0], parts[1]
	switch scopeKey {
	case nodeScopeKey:
		if value == "" {
			return []PodSummary{}, nil
		}
		return filterPodRows(rows, func(row PodSummary) bool { return row.Node == value }), nil
	case workloadScopeKey:
		parsed, err := parseWorkloadScope(value)
		if err != nil {
			return nil, err
		}
		return filterPodRows(rows, func(row PodSummary) bool { return podRowMatchesWorkload(row, parsed) }), nil
	case namespaceScopeKey:
		namespace := strings.TrimSpace(value)
		if namespace == "" {
			return nil, fmt.Errorf("invalid namespace scope: %s", scope)
		}
		if namespace == "all" || namespace == "*" {
			return append([]PodSummary(nil), rows...), nil
		}
		return filterPodRows(rows, func(row PodSummary) bool { return row.Namespace == namespace }), nil
	default:
		return nil, fmt.Errorf("unsupported pods scope: %s", scope)
	}
}

func filterPodRows(rows []PodSummary, keep func(PodSummary) bool) []PodSummary {
	out := make([]PodSummary, 0, len(rows))
	for _, row := range rows {
		if keep(row) {
			out = append(out, row)
		}
	}
	return out
}

// podRowMatchesWorkload reports whether a stored pod row belongs to the workload
// scope, mirroring matchesWorkload exactly: the scope matches the row's DIRECT
// controlling owner (DirectOwner* — the ownerRef as written on the pod, which is
// what a ReplicaSet-scoped Pods window names) or its COLLAPSED owner (Owner* —
// ReplicaSet resolved to its Deployment by BuildStreamSummary, which is what a
// Deployment-scoped window names). Matching only the collapsed owner left every
// ReplicaSet-scoped window empty: the collapse erases the RS identity.
func podRowMatchesWorkload(row PodSummary, scope workloadScope) bool {
	if row.Namespace != scope.namespace {
		return false
	}
	return ownerTripleMatchesScope(row.DirectOwnerAPIVersion, row.DirectOwnerKind, row.DirectOwnerName, scope) ||
		ownerTripleMatchesScope(row.OwnerAPIVersion, row.OwnerKind, row.OwnerName, scope)
}

// ownerTripleMatchesScope compares one stored owner identity against the scope's
// full group/version/kind/name (the row-side twin of ownerMatchesWorkloadScope).
func ownerTripleMatchesScope(apiVersion, kind, name string, scope workloadScope) bool {
	gv, err := schema.ParseGroupVersion(apiVersion)
	if err != nil {
		return false
	}
	return gv.Group == scope.group &&
		gv.Version == scope.version &&
		kind == scope.kind &&
		name == scope.name
}

// metricSampleValid reports whether a metrics sample may be overlaid onto an object
// row whose creation time is creationMillis (UnixMilli, 0 if unknown). A sample is
// rejected when (a) it is absent (ok=false) or (b) it was scraped before the object
// was created — i.e. it belongs to a prior incarnation of a same-named object (a pod
// deleted and recreated under the same name with a new UID). metrics-server exposes
// no UID, so the sample-Timestamp-vs-creationTimestamp comparison is the sound proxy
// for the plan's name->UID join (v2 architecture Risk #9 / §3.6). A zero sample
// Timestamp (e.g. a test or a metrics source that omits it) is treated as valid so
// real-zero usage still renders its numbers. Freshness is capped at the scrape
// interval, which the plan accepts.
func metricSampleValid(ok bool, sampleTime time.Time, creationMillis int64) bool {
	if !ok {
		return false
	}
	if creationMillis > 0 && !sampleTime.IsZero() && sampleTime.UnixMilli() < creationMillis {
		return false
	}
	return true
}

// formatPodMetricCPU and formatPodMetricMemory render a pod's usage cell: the
// formatted number for a valid sample, otherwise the no-data marker (never "0m"/
// "0Mi", so "metrics unknown" is distinguishable from a real zero).
func formatPodMetricCPU(usage metrics.PodUsage, ok bool, creationMillis int64) string {
	if !metricSampleValid(ok, usage.Timestamp, creationMillis) {
		return streamrows.MetricsNoData
	}
	return streamrows.FormatCPUMilli(usage.CPUUsageMilli)
}

func formatPodMetricMemory(usage metrics.PodUsage, ok bool, creationMillis int64) string {
	if !metricSampleValid(ok, usage.Timestamp, creationMillis) {
		return streamrows.MetricsNoData
	}
	return streamrows.FormatMemoryBytes(usage.MemoryUsageBytes)
}

// overlayPodMetrics joins an explicit metrics sample onto the SERVED row copies
// (never the stored rows). A pod with no sample, or a sample that predates the
// row's creation (a recreated same-name pod inheriting a prior incarnation's
// numbers), renders the no-data marker rather than stale or zero numbers.
func overlayPodMetrics(rows []PodSummary, podUsage map[string]metrics.PodUsage) {
	for i := range rows {
		usage, ok := podUsage[rows[i].Namespace+"/"+rows[i].Name]
		rows[i].CPUUsage = formatPodMetricCPU(usage, ok, rows[i].AgeTimestamp)
		rows[i].MemUsage = formatPodMetricMemory(usage, ok, rows[i].AgeTimestamp)
	}
}

// podStoreServableNamespace reports whether baseScope is a namespace scope the
// maintained store can serve, returning the namespace to filter by ("" for all
// namespaces). Node and workload scopes are not store-servable. It remains for the
// builder that has BOTH a typed lister and a store (no longer the production wiring,
// but kept so a mixed builder still serves namespace scopes from RAM).
func podStoreServableNamespace(baseScope string) (string, bool) {
	value, ok := strings.CutPrefix(baseScope, namespaceScopeKey+":")
	if !ok {
		return "", false
	}
	value = strings.TrimSpace(value)
	if value == "" {
		return "", false
	}
	if value == "all" || value == "*" {
		return "", true
	}
	return value, true
}

func podTableQueryAdapter() typedTableQueryAdapter[PodSummary] {
	return typedTableQueryAdapter[PodSummary]{
		Key: func(pod PodSummary) string {
			return fmt.Sprintf("%s/%s", strings.ToLower(pod.Namespace), strings.ToLower(pod.Name))
		},
		AnchorKey: func(_, namespace, name string) string {
			return fmt.Sprintf("%s/%s", strings.ToLower(namespace), strings.ToLower(name))
		},
		Namespace: func(pod PodSummary) string { return pod.Namespace },
		Kind:      func(PodSummary) string { return podres.Identity.Kind },
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
					return podSummaryUnhealthy(pod)
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

func parseReadyPairInt32(value string) (int32, int32, bool) {
	parts := strings.Split(strings.TrimSpace(value), "/")
	if len(parts) != 2 {
		return 0, 0, false
	}
	ready, readyErr := strconv.ParseInt(strings.TrimSpace(parts[0]), 10, 32)
	total, totalErr := strconv.ParseInt(strings.TrimSpace(parts[1]), 10, 32)
	if readyErr != nil || totalErr != nil {
		return 0, 0, false
	}
	return int32(ready), int32(total), true
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
	group     string
	version   string
	kind      string
	name      string
}

func parseWorkloadScope(value string) (workloadScope, error) {
	parts := strings.Split(value, ":")
	if len(parts) != 5 {
		return workloadScope{}, fmt.Errorf("invalid workload scope: %s", value)
	}
	namespace := strings.TrimSpace(parts[0])
	group := strings.TrimSpace(parts[1])
	version := strings.TrimSpace(parts[2])
	kind := strings.TrimSpace(parts[3])
	name := strings.TrimSpace(parts[4])
	if namespace == "" || group == "" || version == "" || kind == "" || name == "" {
		return workloadScope{}, fmt.Errorf("invalid workload scope: %s", value)
	}
	return workloadScope{
		namespace: namespace,
		group:     group,
		version:   version,
		kind:      kind,
		name:      name,
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
		if owner.Kind == replicasetpkg.Identity.Kind && scope.kind == deploymentpkg.Identity.Kind && rsLister != nil {
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
	return gv.Group == scope.group &&
		gv.Version == scope.version &&
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
			if owner.Controller == nil || !*owner.Controller || owner.Kind != replicasetpkg.Identity.Kind {
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
				if rsOwner.Controller != nil && *rsOwner.Controller && rsOwner.Kind == deploymentpkg.Identity.Kind {
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
