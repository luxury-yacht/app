package snapshot

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
	"time"

	podres "github.com/luxury-yacht/app/backend/resources/pods"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
	"github.com/luxury-yacht/app/backend/refresh/metrics"
	"github.com/luxury-yacht/app/backend/refresh/querypage"
)

// PodBuilder serves pod rows projected at intake, scoped by namespace, node or workload.
// Each builder and its stores belong to one cluster.
type PodBuilder struct {
	maintained *typedMaintainedStore[PodSummary]
	// Usage is joined onto served copies, never stored in the maintained rows.
	metrics metrics.Provider
	// Query indexes are reused while the object version and metric revision match.
	perBuild *perBuildStoreCache[PodSummary]
}

func podSummaryWithoutMetrics(summary PodSummary) PodSummary {
	summary.CPUUsage = streamrows.MetricsNoData
	summary.MemUsage = streamrows.MetricsNoData
	return summary
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
const podNotReadyFilter = "not-ready"

var podHealthFilterModes = []string{"unhealthy", "restarts", podNotReadyFilter}

// podSummaryUnhealthy reports whether a pod row should count as unhealthy. It is
// the single source for the "unhealthy" notion shared by the scope count and the
// "show unhealthy" query predicate, so the badge and the filter stay consistent.
func podSummaryUnhealthy(pod PodSummary) bool {
	presentation := strings.ToLower(strings.TrimSpace(pod.StatusPresentation))
	return presentation == "warning" || presentation == "error" ||
		presentation == podNotReadyFilter || presentation == "terminating"
}

func podQueryCapabilities() ResourceQueryCapabilities {
	return newTypedResourceCapabilities(
		[]string{"name", "namespace", "status", "ready", "restarts", "owner", "node", "cpu", "memory", "age"},
		[]string{"kinds", "namespaces"},
		[]string{"name", "namespace", "status", "ready", "owner", "node"},
		[]string{podres.Identity.Kind},
		typedTableFacetDescriptors(podQueryFacets())...,
	)
}

func podQueryFacets() []typedTableQueryFacet[PodSummary] {
	return []typedTableQueryFacet[PodSummary]{
		statusQueryFacet(func(pod PodSummary) string { return pod.Status }),
		podOwnerQueryFacet(),
		nodeQueryFacet(func(pod PodSummary) string { return pod.Node }),
	}
}

func podOwnerQueryFacet() typedTableQueryFacet[PodSummary] {
	return typedTableQueryFacet[PodSummary]{
		Descriptor: ResourceQueryFacetDescriptor{
			Key:         "owners",
			Label:       "Owner",
			Placeholder: "All owners",
			Searchable:  true,
			BulkActions: true,
		},
		Values: podOwnerFacetValues,
		Label:  podOwnerFacetLabel,
	}
}

// Pod Owner facet values carry complete object identities in stable JSON
// tuples: [scope, kind, name, clusterId, group, version, namespace]. A standalone
// Pod uses its own identity so selecting that row in Workloads isolates exactly
// that Pod instead of every ownerless Pod in the namespace.
func podOwnerFacetValues(pod PodSummary) []string {
	if strings.EqualFold(strings.TrimSpace(pod.OwnerKind), "none") || strings.TrimSpace(pod.OwnerName) == "" {
		return []string{encodePodOwnerFacetValue("pod", podres.Identity.Kind, pod.Ref.Name, pod.Ref.ClusterID, podres.Identity.Group, podres.Identity.Version, pod.Ref.Namespace)}
	}
	gv, err := schema.ParseGroupVersion(strings.TrimSpace(pod.OwnerAPIVersion))
	if err != nil || strings.TrimSpace(pod.OwnerKind) == "" {
		return nil
	}
	values := []string{encodePodOwnerFacetValue("owner", pod.OwnerKind, pod.OwnerName, pod.Ref.ClusterID, gv.Group, gv.Version, pod.Ref.Namespace)}
	if pod.DirectOwnerKind == "" || pod.DirectOwnerName == "" {
		return values
	}
	directGV, err := schema.ParseGroupVersion(strings.TrimSpace(pod.DirectOwnerAPIVersion))
	if err != nil {
		return values
	}
	direct := encodePodOwnerFacetValue("owner", pod.DirectOwnerKind, pod.DirectOwnerName, pod.Ref.ClusterID, directGV.Group, directGV.Version, pod.Ref.Namespace)
	if direct != values[0] {
		values = append(values, direct)
	}
	return values
}

func encodePodOwnerFacetValue(scope, kind, name, clusterID, group, version, namespace string) string {
	encoded, _ := json.Marshal([]string{scope, kind, name, clusterID, group, version, namespace})
	return string(encoded)
}

func podOwnerFacetLabel(value string) string {
	var identity []string
	if err := json.Unmarshal([]byte(value), &identity); err != nil || len(identity) != 7 {
		return value
	}
	if identity[0] == "pod" {
		return "No owner: " + identity[2]
	}
	return identity[1] + "/" + identity[2]
}

// podQuerypageSchema derives the querypage Schema for the pods table from its
// typed-table adapter, reusing the adapter's exact sort-value encoder and row key so
// the engine orders rows byte-identically to the live executor. The sort fields
// mirror the sortable fields published by podQueryCapabilities; cpu/memory sort the
// live usage joined at serve.
func podQuerypageSchema() querypage.Schema[PodSummary] {
	return querypageSchemaFromAdapter(
		podTableQueryAdapter(),
		podQueryCapabilities().SortableFields,
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
	objectScopeKey    = "object"
	nodeScopeKey      = "node"
	namespaceScopeKey = "namespace"
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

	summaries, version, err := b.collectSummariesFromStore(baseScope)
	if err != nil {
		return nil, err
	}
	// Join the latest poller usage onto the served copies. The maintained store's
	// rows keep the no-data marker: a metric tick changes only this serve output
	// and the metric source clock, never the stored rows or the object version.
	overlayPodMetrics(summaries, podUsage)

	adapter := podTableQueryAdapter()
	healthCounts := podHealthCounts(summaries, adapter)

	// Pre-sort by (namespace, name) ONLY for the window branch, which truncates
	// input order. The query branch re-sorts via the engine and ignores this
	// order — sorting the full scope there is wasted work on every doorbell
	// refetch (pinned by TestPodBuilderWindowScopeOrdersRowsByNamespaceThenName).
	if !query.Enabled {
		sort.Slice(summaries, func(i, j int) bool {
			if summaries[i].Ref.Namespace == summaries[j].Ref.Namespace {
				return summaries[i].Ref.Name < summaries[j].Ref.Name
			}
			return summaries[i].Ref.Namespace < summaries[j].Ref.Namespace
		})
	}

	// Serve the query branch through the querypage engine (proven byte-equivalent to
	// the bespoke typed-table executor in querypage_pods_test.go); the window branch
	// and all envelope wiring are unchanged.
	sources := withTypedTableResourceReadiness(ctx, podDomainName, []typedTableResourceSource{{
		Kind: podres.Identity.Kind, Group: "", Resource: "pods", State: typedTableResourceAvailable,
	}})
	resolved := resolveTypedSnapshotPageViaStore(
		podDomainName,
		summaries,
		query,
		adapter,
		podQuerypageSchema(),
		newTypedSnapshotPageConfig(
			podQueryCapabilities(),
			config.SnapshotNamespacePodsEntryLimit,
			"pods",
			func(PodSummary) string { return podres.Identity.Kind },
			typedTableQueryResourceIssues(ctx, podDomainName, query, sources),
		),
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
			TotalCount:            len(summaries),
			HealthCounts:          healthCounts,
		},
		Stats: resolved.Stats,
	}

	return snapshot, nil
}

// Count through the table predicate so badges and their filters use the same policy.
func podHealthCounts(rows []PodSummary, adapter typedTableQueryAdapter[PodSummary]) map[string]int {
	counts := map[string]int{}
	for _, row := range rows {
		for _, mode := range podHealthFilterModes {
			if adapter.Predicate(row, "health", mode) {
				counts[mode]++
			}
		}
	}
	return counts
}

// collectSummariesFromStore filters intake-projected rows by the requested scope.
// The store's version changes on intake updates, independently of metrics.
func (b *PodBuilder) collectSummariesFromStore(baseScope string) ([]PodSummary, uint64, error) {
	all := b.maintained.rows("", map[string]bool{podres.Identity.Kind: true})
	rows, err := filterPodRowsByScope(all, baseScope)
	if err != nil {
		return nil, 0, err
	}
	return rows, b.maintained.snapshotVersion(), nil
}

// filterPodRowsByScope matches node and namespace scopes against projected rows,
// and workload scopes against their resolved and direct owner identities.
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
	case objectScopeKey:
		parsed, err := parsePodObjectScope(value)
		if err != nil {
			return nil, err
		}
		return filterPodRows(rows, func(row PodSummary) bool {
			return row.Ref.Namespace == parsed.namespace && row.Ref.Name == parsed.name
		}), nil
	case namespaceScopeKey:
		namespace := strings.TrimSpace(value)
		if namespace == "" {
			return nil, fmt.Errorf("invalid namespace scope: %s", scope)
		}
		if namespace == "all" || namespace == "*" {
			return append([]PodSummary(nil), rows...), nil
		}
		return filterPodRows(rows, func(row PodSummary) bool { return row.Ref.Namespace == namespace }), nil
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

// podRowMatchesWorkload accepts either the direct controller or resolved owner.
// ReplicaSet panels need the direct owner even after resolution to a Deployment.
func podRowMatchesWorkload(row PodSummary, scope workloadScope) bool {
	if row.Ref.Namespace != scope.namespace {
		return false
	}
	return ownerTripleMatchesScope(row.DirectOwnerAPIVersion, row.DirectOwnerKind, row.DirectOwnerName, scope) ||
		ownerTripleMatchesScope(row.OwnerAPIVersion, row.OwnerKind, row.OwnerName, scope)
}

// ownerTripleMatchesScope compares the complete owner identity with the scope.
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
		usage, ok := podUsage[rows[i].Ref.Namespace+"/"+rows[i].Ref.Name]
		rows[i].CPUUsage = formatPodMetricCPU(usage, ok, rows[i].AgeTimestamp)
		rows[i].MemUsage = formatPodMetricMemory(usage, ok, rows[i].AgeTimestamp)
	}
}

func podTableQueryAdapter() typedTableQueryAdapter[PodSummary] {
	return typedTableQueryAdapter[PodSummary]{
		Key: func(pod PodSummary) string {
			return fmt.Sprintf("%s/%s", strings.ToLower(pod.Ref.Namespace), strings.ToLower(pod.Ref.Name))
		},
		AnchorKey: func(_, namespace, name string) string {
			return fmt.Sprintf("%s/%s", strings.ToLower(namespace), strings.ToLower(name))
		},
		Namespace: func(pod PodSummary) string { return pod.Ref.Namespace },
		Kind:      func(PodSummary) string { return podres.Identity.Kind },
		Facets:    podQueryFacets(),
		SearchText: func(pod PodSummary) []string {
			return []string{
				pod.Ref.Name,
				pod.Ref.Namespace,
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
				case podNotReadyFilter:
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
				return pod.Ref.Namespace
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
				return pod.Ref.Name
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

type workloadScope struct {
	namespace string
	group     string
	version   string
	kind      string
	name      string
}

type podObjectScope struct {
	namespace string
	name      string
}

// parsePodObjectScope accepts the complete Kubernetes identity encoded by the
// frontend selection. Pods are core/v1, so the group segment is intentionally
// empty in object:<namespace>::v1:Pod:<name>.
func parsePodObjectScope(value string) (podObjectScope, error) {
	parts := strings.Split(value, ":")
	if len(parts) != 5 {
		return podObjectScope{}, fmt.Errorf("invalid object scope: %s", value)
	}
	namespace := strings.TrimSpace(parts[0])
	group := strings.TrimSpace(parts[1])
	version := strings.TrimSpace(parts[2])
	kind := strings.TrimSpace(parts[3])
	name := strings.TrimSpace(parts[4])
	if namespace == "" || version == "" || kind == "" || name == "" {
		return podObjectScope{}, fmt.Errorf("invalid object scope: %s", value)
	}
	if group != podres.Identity.Group || version != podres.Identity.Version || kind != podres.Identity.Kind {
		return podObjectScope{}, fmt.Errorf("unsupported object scope: %s", value)
	}
	return podObjectScope{namespace: namespace, name: name}, nil
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
