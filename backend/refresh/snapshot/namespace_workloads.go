// backend/refresh/snapshot/namespace_workloads.go
//
// Builds namespace workload refresh snapshots and projects the row facts needed
// by workload tables, stream rows, and object-action surfaces.
package snapshot

import (
	"context"
	"errors"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"

	replicasetpkg "github.com/luxury-yacht/app/backend/resources/replicaset"

	"github.com/luxury-yacht/app/backend/resources/common"
	appsv1 "k8s.io/api/apps/v1"
	autoscalingv1 "k8s.io/api/autoscaling/v1"
	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/labels"
	"k8s.io/apimachinery/pkg/runtime/schema"
	informers "k8s.io/client-go/informers"
	autoscalinglisters "k8s.io/client-go/listers/autoscaling/v1"

	"github.com/luxury-yacht/app/backend/internal/config"
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
	podres "github.com/luxury-yacht/app/backend/resources/pods"
	"github.com/luxury-yacht/app/backend/resources/statefulset"
)

const (
	namespaceWorkloadsDomainName = "namespace-workloads"
	errNamespaceScopeRequired    = "namespace scope is required"
)

// NamespaceWorkloadsPermissions indicates which resources should be included in the domain.
type NamespaceWorkloadsPermissions struct {
	IncludePods         bool
	IncludeDeployments  bool
	IncludeStatefulSets bool
	IncludeDaemonSets   bool
	IncludeJobs         bool
	IncludeCronJobs     bool
}

// NamespaceWorkloadsBuilder constructs namespace-scoped workload snapshots. Pods AND the
// five workload kinds (Deployment/StatefulSet/DaemonSet/Job/CronJob) are cut to the ingest
// path. The workload OWN-rows (each kind's projected workload-OWN-fields WorkloadSummary, the
// Bundle Table half) are served from a per-cluster maintained store fed by the
// five workload GVRs' Table-half ingest Sinks — the SAME mechanism nodes/pods use. The pod
// aggregation (per-owner ready/resources) and the synthesized standalone-pod rows are cross-kind
// serve-time joins read from the pod ingest source, and the serve path re-joins the owner's pods +
// HPA onto each own-row (reaggregateWorkloadSummary), byte-identical to the typed path.
// The include* flags record whether the request is permitted to read each kind (the gate the
// typed listers' presence used to imply).
type NamespaceWorkloadsBuilder struct {
	podIngest           podWorkloadsIngestSource
	includePods         bool
	workloadIngest      workloadIngestSource
	includeDeployments  bool
	includeStatefulSets bool
	includeDaemonSets   bool
	includeJobs         bool
	includeCronJobs     bool
	hpaLister           autoscalinglisters.HorizontalPodAutoscalerLister
	logger              containerlogsstream.Logger

	// workloadsMaintained holds the workload OWN-rows (WorkloadSummary for the five workload
	// kinds, no pod-join), fed by each workload GVR's Table-half ingest Sink.
	// Build reads own-rows from it (scope-filtered) and re-joins pods + HPA +
	// synthesizes standalone pods at serve (§3.6). nil in a unit test with no store wired, in
	// which case no workload own-rows are served.
	//
	// The standalone-pod determination is intentionally NOT in this store: it is a cross-kind
	// join (a pod is standalone iff no workload owns it), so it cannot be fed one object per
	// event — it is computed at serve from the pod ingest source, exactly as the pod-aggregate
	// + HPA overlays are.
	workloadsMaintained *typedMaintainedStore[WorkloadSummary]
}

// podWorkloadsIngestSource supplies the cut pod kind's projected rows the workloads
// domain reads. Rows returns the per-object bundles (Table + Aggregate halves) in ONE
// consistent store read, so the standalone row's PodSummary and its PodAggregate always
// belong to the same pod (a separate AggregateRows/TableRows pair could desync across a
// concurrent reflector mutation). StoreResourceVersion gives the pod store's RV for the
// version watermark. *ingest.IngestManager satisfies it.
type podWorkloadsIngestSource interface {
	Rows(gvr schema.GroupVersionResource) []interface{}
	StoreResourceVersion(gvr schema.GroupVersionResource) string
}

// NamespaceWorkloadsSnapshot is returned to the frontend.
type NamespaceWorkloadsSnapshot struct {
	ClusterMeta
	ResourceQueryEnvelope
	Rows []WorkloadSummary `json:"rows"`
}

func namespaceWorkloadsQueryCapabilities() ResourceQueryCapabilities {
	return newTypedResourceCapabilities(
		[]string{"name", "kind", "namespace", "status", "ready", "restarts", "age"},
		[]string{"kinds", "namespaces"},
		[]string{"kind", "name", "namespace", "status", "ready"},
		[]string{podres.Identity.Kind, deployment.Identity.Kind, statefulset.Identity.Kind, daemonset.Identity.Kind, jobres.Identity.Kind, cronjob.Identity.Kind},
	)
}

// WorkloadSummary lives in the streamrows leaf so every streaming row type has
// one home; this alias keeps the snapshot-side name and wire JSON unchanged. The
// row is a unified cross-kind workload aggregation, so its builder stays in this
// domain (moving it to a kind package would cycle through resourcecontract).
type WorkloadSummary = streamrows.WorkloadSummary

// RegisterNamespaceWorkloadsDomain wires the workloads domain into the registry. The five
// workload kinds are cut to the ingest path: their projected workload OWN-rows are served from a
// per-cluster maintained store fed by EACH workload GVR's Table-half ingest Sink (the SAME
// mechanism nodes/pods use). One typedMaintainedStore[WorkloadSummary] holds all five kinds — the
// Sink type-guards on WorkloadSummary, so feeding all five GVRs into it is correct, and the five
// kinds key distinctly (adapter Key is kind/namespace/name). The Sinks are registered BEFORE the
// ingest manager starts (this runs during registration), so the snapshot sync gate guarantees the
// store is populated before the first Build serves from it. The per-owner pod aggregation,
// metrics, HPA, and synthesized standalone-pod rows are re-joined at serve. ingestManager may be
// nil in a unit test, in which case the store has no feed and no pods are read. The per-kind
// include flags gate which kinds the request is permitted to read (the gate the typed listers'
// presence used to imply).
// workloadStoreGVRKinds pairs each workload GVR that feeds the shared workloads maintained store
// with the kind its projected rows carry. The five workload kinds share ONE store, so each GVR's
// bundle sink must be scoped to its own kind — otherwise a relist of one GVR's reflector replaces
// the whole store with just that kind and drops the other four (the "StatefulSets missing" bug).
// GVR and kind both derive from the same resource Identity, so they cannot drift apart.
var workloadStoreGVRKinds = []struct {
	GVR  schema.GroupVersionResource
	Kind string
}{
	{DeploymentGVR, deployment.Identity.Kind},
	{StatefulSetGVR, statefulset.Identity.Kind},
	{DaemonSetGVR, daemonset.Identity.Kind},
	{JobGVR, jobres.Identity.Kind},
	{CronJobGVR, cronjob.Identity.Kind},
}

// feedWorkloadStoreFromIngest wires each workload GVR's whole-bundle ingest Sink into the one
// shared workloads store, scoped to that GVR's kind. Each kind's projector emits a WorkloadSummary
// Table half (upserted by key) and a Catalog half (the delete key), so they all land in this store;
// a relist of one GVR replaces only that kind's rows. Shared by the workloads domain and its
// metrics twin. nil ingestManager (a unit test) leaves the store with no feed.
func feedWorkloadStoreFromIngest(ingestManager *ingest.IngestManager, maintained *typedMaintainedStore[WorkloadSummary]) {
	if ingestManager == nil {
		return
	}
	for _, wk := range workloadStoreGVRKinds {
		ingestManager.AddBundleSink(wk.GVR, maintained.bundleSinkForKind(wk.Kind))
	}
}

func RegisterNamespaceWorkloadsDomain(
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
	builder := &NamespaceWorkloadsBuilder{
		// HPA lister is always wired — it's informational and doesn't block on missing perms.
		hpaLister: factory.Autoscaling().V1().HorizontalPodAutoscalers().Lister(),
		// workloadIngest supplies only the workload stores' RVs for the version watermark; the
		// own-rows come from the Sink-fed maintained store.
		workloadIngest:      ingestManager,
		logger:              logger,
		workloadsMaintained: maintained,
	}
	if perms.IncludePods {
		// Pods is cut to the ingest path: the per-owner aggregation and standalone-pod
		// rows read the pod kind's projected rows from the ingest manager.
		builder.podIngest = ingestManager
		builder.includePods = true
	}
	builder.includeDeployments = perms.IncludeDeployments
	builder.includeStatefulSets = perms.IncludeStatefulSets
	builder.includeDaemonSets = perms.IncludeDaemonSets
	builder.includeJobs = perms.IncludeJobs
	builder.includeCronJobs = perms.IncludeCronJobs
	// Spill/restore the workload OWN-rows store across Cold/re-warm. The fresh reflectors' initial
	// resync reconciles a stale-spill row on re-warm (the ingest-fed path delivers a Delete for
	// any object removed while Cold), so no reconcile source is registered here — the same as
	// nodes/pods.
	reg.RegisterMaintainedStore(namespaceWorkloadsDomainName, builder.workloadsMaintained)
	return reg.Register(refresh.DomainConfig{
		Name:          namespaceWorkloadsDomainName,
		BuildSnapshot: builder.Build,
	})
}

// Build assembles workload summaries for the requested namespace scope. The workload OWN-rows
// come from the Sink-fed maintained store (scope-filtered to the request's namespace + permitted
// kinds); the per-owner pod aggregation, HPA, and synthesized standalone-pod rows are re-joined at
// serve from the pod ingest source + HPA lister. The all-namespaces overview joins pods by the
// emitted workload OWN-row owner keys so resource reservations and status can be computed without
// synthesizing standalone pod rows across every namespace.
func (b *NamespaceWorkloadsBuilder) Build(ctx context.Context, scope string) (*refresh.Snapshot, error) {
	meta := ClusterMetaFromContext(ctx)
	clusterID, trimmed := refresh.SplitClusterScope(scope)
	baseScope, query, err := parseTypedTableQueryScope(clusterID, strings.TrimSpace(trimmed), namespaceWorkloadsDomainName, "")
	if err != nil {
		return nil, err
	}
	parsedScope, err := parseNamespaceSnapshotScope(refresh.JoinClusterScope(clusterID, baseScope), errNamespaceScopeRequired)
	if err != nil {
		return nil, err
	}
	namespace := parsedScope.Namespace
	issues := b.queryIssues(ctx, query)

	// The workload OWN-rows come from the Sink-fed maintained store, scope-filtered to the
	// namespace ("" = all namespaces) and the kinds this request is permitted to read — the
	// SAME per-kind runtime gate the typed path applied.
	ownRows := b.workloadOwnRows(ctx, namespace)

	var (
		podAggregates []streamrows.PodAggregate
		podSummaries  map[string]streamrows.PodSummary
	)
	if b.includePods && b.podIngest != nil && runtimeResourceAllowed(ctx, namespaceWorkloadsDomainName, "", "pods") {
		if parsedScope.AllNamespaces {
			podAggregates, podSummaries = workloadOwnerPodRowsFromIngest(b.podIngest, ownRows)
		} else {
			podAggregates, podSummaries = namespacePodRowsFromIngest(b.podIngest, namespace)
		}
	}

	// List HPAs to mark workloads that are managed by an autoscaler. If this
	// coverage is unavailable, leave ownership unknown instead of emitting false.
	hpas, hpaErr := b.listHPAs(namespace)

	snapshot, err := b.buildSnapshot(meta, refresh.JoinClusterScope(clusterID, strings.TrimSpace(trimmed)), query, podAggregates, podSummaries, ownRows, hpas, hpaErr == nil, issues)
	if err != nil {
		return nil, err
	}
	return snapshot, nil
}

// workloadOwnRows returns the workload OWN-rows from the Sink-fed maintained store for the request
// namespace ("" = all namespaces), restricted to the kinds this request is permitted to read. A
// nil store (a unit test with no store wired) yields no rows.
func (b *NamespaceWorkloadsBuilder) workloadOwnRows(ctx context.Context, namespace string) []WorkloadSummary {
	if b.workloadsMaintained == nil {
		return nil
	}
	return b.workloadsMaintained.rows(namespace, b.allowedWorkloadKinds(ctx))
}

func (b *NamespaceWorkloadsBuilder) workloadOwnRowsForDomain(ctx context.Context, domainName string, namespace string) []WorkloadSummary {
	if b.workloadsMaintained == nil {
		return nil
	}
	return b.workloadsMaintained.rows(namespace, b.allowedWorkloadKindsForDomain(ctx, domainName))
}

func (b *NamespaceWorkloadsBuilder) buildSnapshot(
	meta ClusterMeta,
	scope string,
	query typedTableQuery,
	podAggregates []streamrows.PodAggregate,
	podSummaries map[string]streamrows.PodSummary,
	ownRows []WorkloadSummary,
	hpas []*autoscalingv1.HorizontalPodAutoscaler,
	hpaKnown bool,
	issues []ResourceQueryIssue,
) (*refresh.Snapshot, error) {
	items, version := assembleWorkloadRows(
		meta, podAggregates, podSummaries,
		ownRows,
		hpas, hpaKnown, map[string]metrics.PodUsage{},
		namespaceWorkloadIngestVersion(b.workloadIngest, DeploymentGVR, StatefulSetGVR, DaemonSetGVR, JobGVR, CronJobGVR),
		namespacePodIngestVersion(b.podIngest),
	)

	resolved := resolveTypedSnapshotPageViaStore(
		namespaceWorkloadsDomainName,
		items,
		query,
		workloadTableQueryAdapter(),
		workloadsQuerypageSchema(),
		b.queryCapabilities(),
		config.SnapshotNamespaceWorkloadsEntryLimit,
		"workloads",
		func(r WorkloadSummary) string { return r.Kind },
		issues,
	)
	return &refresh.Snapshot{
		Domain:  namespaceWorkloadsDomainName,
		Scope:   scope,
		Version: version,
		Payload: NamespaceWorkloadsSnapshot{
			ClusterMeta:           meta,
			ResourceQueryEnvelope: resolved.Envelope,
			Rows:                  resolved.Rows,
		},
		Stats: resolved.Stats,
	}, nil
}

// assembleWorkloadRows builds the unified workload + standalone-pod rows for the domain from the
// projected workload own-rows (all five kinds in one slice, from the Sink-fed store), pod
// aggregates/summaries, HPA targets, and the fresh pod metrics sample. The standalone-pod
// synthesis emits one row per non-terminal pod that has no controller owner; an owned pod is folded
// into its workload (never its own row), regardless of whether that workload is in the emitted set.
// workloadIngestVersion/podIngestVersion are the
// cut stores' watermarks, folded into the returned version only when a workload / standalone-pod
// row is actually emitted (matching the prior per-object RV fold).
func assembleWorkloadRows(
	meta ClusterMeta,
	podAggregates []streamrows.PodAggregate,
	podSummaries map[string]streamrows.PodSummary,
	ownRows []WorkloadSummary,
	hpas []*autoscalingv1.HorizontalPodAutoscaler,
	hpaKnown bool,
	podUsage map[string]metrics.PodUsage,
	workloadIngestVersion uint64,
	podIngestVersion uint64,
) ([]WorkloadSummary, uint64) {
	// Build a set of HPA-managed workloads keyed by full target GVK + namespace/name.
	hpaTargets := buildHPATargetSet(hpas)

	// Group pods by their owner key (the string-suffix RS->Deployment collapse), read
	// straight from the projected aggregate. namespace-workloads never reads WorkloadKind.
	podsByOwner := make(map[string][]streamrows.PodAggregate)
	for _, agg := range podAggregates {
		if agg.OwnerKey != "" {
			podsByOwner[agg.OwnerKey] = append(podsByOwner[agg.OwnerKey], agg)
		}
	}

	var (
		items   []WorkloadSummary
		version uint64
	)

	appendSummary := func(summary WorkloadSummary, obj metav1.Object) {
		summary.ClusterMeta = meta
		// Mark as HPA-managed only when the HPA target carries the same full
		// GVK. Kind/name-only matching can collide with custom resources.
		if hpaKnown {
			managed := false
			if _, ok := hpaTargets[workloadHPATargetKey(summary)]; ok {
				managed = true
			}
			summary.HPAManaged = &managed
		}
		items = append(items, summary)
		if obj == nil {
			return
		}
		if v := resourceVersionOrTimestamp(obj); v > version {
			version = v
		}
	}

	// The workload kinds are cut: each `ownRow` is the projected workload-OWN-fields
	// WorkloadSummary the reflector built at intake. The serve path re-joins the owner's
	// pods + the metrics sample onto it (reaggregateWorkloadSummary). The projected row
	// carries no per-object resourceVersion, so each is appended with a nil object — the
	// workload store's RV is folded into the version watermark once below.
	reaggregate := func(ownRow WorkloadSummary) WorkloadSummary {
		key := workloadOwnerKey(ownRow.Kind, ownRow.Namespace, ownRow.Name)
		return reaggregateWorkloadSummary(ownRow, podsByOwner[key], podUsage)
	}
	workloadEmitted := false
	for _, ownRow := range ownRows {
		appendSummary(reaggregate(ownRow), nil)
		workloadEmitted = true
	}
	if workloadEmitted && workloadIngestVersion > version {
		version = workloadIngestVersion
	}

	standalonePodEmitted := false
	for _, agg := range podAggregates {
		if agg.Phase == string(corev1.PodSucceeded) || agg.Phase == string(corev1.PodFailed) {
			continue
		}
		// The workloads view shows OWN-rows plus pods with no owner; a pod with a
		// controller owner is folded into its workload (podsByOwner above) and is never
		// emitted as a row, even when its owning workload is absent from this snapshot.
		if agg.OwnerKey != "" {
			continue
		}
		// The standalone row reads the pod's projected PodSummary (status/age/ports/
		// ready/restarts) plus this aggregate (resources), byte-identical to the prior
		// typed buildStandalonePodSummary. A missing summary (race between the two
		// halves) falls back to the aggregate-only fields, never panicking.
		summary := buildStandalonePodSummaryFromRows(podSummaries[agg.Namespace+"/"+agg.Name], agg, podUsage)
		appendSummary(summary, nil)
		standalonePodEmitted = true
	}
	// Standalone-pod rows carry no per-object RV (the typed pod is gone); when any is
	// emitted the pod store's RV is folded into the watermark. Workload-owned pods never
	// contributed (they were not appended as rows), so the fold is gated on a standalone row.
	if standalonePodEmitted && podIngestVersion > version {
		version = podIngestVersion
	}

	sortWorkloadSummaries(items)
	return items, version
}

// allowedWorkloadKinds is the set of kinds the request may see — each domain kind gated on
// its registration include flag AND the per-request runtime permission, mirroring the list
// path's per-kind gating so the maintained Build shows the same kinds.
func (b *NamespaceWorkloadsBuilder) allowedWorkloadKinds(ctx context.Context) map[string]bool {
	return b.allowedWorkloadKindsForDomain(ctx, namespaceWorkloadsDomainName)
}

func (b *NamespaceWorkloadsBuilder) allowedWorkloadKindsForDomain(ctx context.Context, domainName string) map[string]bool {
	allowed := map[string]bool{}
	if b.includePods && runtimeResourceAllowed(ctx, domainName, "", "pods") {
		allowed[podres.Identity.Kind] = true
	}
	if b.includeDeployments && runtimeResourceAllowed(ctx, domainName, "apps", "deployments") {
		allowed[deployment.Identity.Kind] = true
	}
	if b.includeStatefulSets && runtimeResourceAllowed(ctx, domainName, "apps", "statefulsets") {
		allowed[statefulset.Identity.Kind] = true
	}
	if b.includeDaemonSets && runtimeResourceAllowed(ctx, domainName, "apps", "daemonsets") {
		allowed[daemonset.Identity.Kind] = true
	}
	if b.includeJobs && runtimeResourceAllowed(ctx, domainName, "batch", "jobs") {
		allowed[jobres.Identity.Kind] = true
	}
	if b.includeCronJobs && runtimeResourceAllowed(ctx, domainName, "batch", "cronjobs") {
		allowed[cronjob.Identity.Kind] = true
	}
	return allowed
}

func sortWorkloadSummaries(items []WorkloadSummary) {
	sort.SliceStable(items, func(i, j int) bool {
		if items[i].Kind != items[j].Kind {
			return items[i].Kind < items[j].Kind
		}
		if items[i].Name != items[j].Name {
			return items[i].Name < items[j].Name
		}
		if items[i].Namespace != items[j].Namespace {
			return items[i].Namespace < items[j].Namespace
		}
		return items[i].Status < items[j].Status
	})
}

func (b *NamespaceWorkloadsBuilder) resourceSources() []typedTableResourceSource {
	return []typedTableResourceSource{
		{
			Kind:       podres.Identity.Kind,
			Group:      "",
			Resource:   "pods",
			Available:  b.includePods,
			QueryKinds: []string{podres.Identity.Kind, deployment.Identity.Kind, statefulset.Identity.Kind, daemonset.Identity.Kind, jobres.Identity.Kind, cronjob.Identity.Kind},
		},
		{Kind: deployment.Identity.Kind, Group: "apps", Resource: "deployments", Available: b.includeDeployments},
		{Kind: statefulset.Identity.Kind, Group: "apps", Resource: "statefulsets", Available: b.includeStatefulSets},
		{Kind: daemonset.Identity.Kind, Group: "apps", Resource: "daemonsets", Available: b.includeDaemonSets},
		{Kind: jobres.Identity.Kind, Group: "batch", Resource: "jobs", Available: b.includeJobs},
		{Kind: cronjob.Identity.Kind, Group: "batch", Resource: "cronjobs", Available: b.includeCronJobs},
	}
}

// queryCapabilities narrows the family vocabulary to the kinds whose backing
// listers exist (see capabilitiesWithAvailableKinds).
func (b *NamespaceWorkloadsBuilder) queryCapabilities() ResourceQueryCapabilities {
	return capabilitiesWithAvailableKinds(namespaceWorkloadsQueryCapabilities(), b.resourceSources())
}

func (b *NamespaceWorkloadsBuilder) queryIssues(ctx context.Context, query typedTableQuery) []ResourceQueryIssue {
	return typedTableQueryResourceIssues(ctx, namespaceWorkloadsDomainName, query, b.resourceSources())
}

func (b *NamespaceWorkloadsBuilder) queryIssuesForDomain(ctx context.Context, domainName string, query typedTableQuery) []ResourceQueryIssue {
	return typedTableQueryResourceIssues(ctx, domainName, query, b.resourceSources())
}

// workloadsQuerypageSchema derives the querypage Schema for the workloads table
// from its typed-table adapter, reusing the adapter's exact sort-value encoder and
// row key so the engine orders rows byte-identically to the live executor. The sort
// fields mirror the sortable fields published by namespaceWorkloadsQueryCapabilities.
func workloadsQuerypageSchema() querypage.Schema[WorkloadSummary] {
	return querypageSchemaFromAdapter(
		workloadTableQueryAdapter(),
		[]string{"name", "kind", "namespace", "status", "ready", "restarts", "age"},
	)
}

func workloadTableQueryAdapter() typedTableQueryAdapter[WorkloadSummary] {
	return typedTableQueryAdapter[WorkloadSummary]{
		Key: func(row WorkloadSummary) string {
			return fmt.Sprintf("%s/%s/%s", strings.ToLower(row.Kind), strings.ToLower(row.Namespace), strings.ToLower(row.Name))
		},
		Namespace: func(row WorkloadSummary) string { return row.Namespace },
		Kind:      func(row WorkloadSummary) string { return row.Kind },
		SearchText: func(row WorkloadSummary) []string {
			return []string{
				row.Kind,
				row.Name,
				row.Namespace,
				row.Status,
				row.Ready,
			}
		},
		Predicate: func(row WorkloadSummary, field, value string) bool {
			switch strings.ToLower(strings.TrimSpace(field)) {
			case "rowkeys":
				return rowKeyPredicateMatches(value, fmt.Sprintf("%s/%s/%s", strings.ToLower(row.Kind), strings.ToLower(row.Namespace), strings.ToLower(row.Name)))
			case "health":
				switch strings.ToLower(strings.TrimSpace(value)) {
				case "restarts":
					return row.Restarts > 0
				case "not-ready":
					ready, total, ok := parseReadyPair(row.Ready)
					return ok && total > 0 && ready < total
				case "unhealthy":
					presentation := strings.ToLower(strings.TrimSpace(row.StatusPresentation))
					return presentation == "warning" || presentation == "error" || presentation == "not-ready"
				default:
					return true
				}
			default:
				return true
			}
		},
		SortValue: func(row WorkloadSummary, field string) string {
			switch strings.ToLower(field) {
			case "kind":
				return row.Kind
			case "namespace":
				return row.Namespace
			case "status":
				return row.Status
			case "ready":
				return row.Ready
			case "restarts":
				return strconv.Itoa(int(row.Restarts))
			case "age":
				return row.Age
			default:
				return row.Name
			}
		},
		NumericSort: func(row WorkloadSummary, field string) (float64, bool) {
			switch strings.ToLower(field) {
			case "restarts":
				return float64(row.Restarts), true
			case "ready":
				ready, total, ok := parseReadyPair(row.Ready)
				if !ok {
					// Keep "ready" uniformly numeric so the page sort and keyset
					// cursor agree; an unparseable pair sorts first ascending.
					return math.Inf(-1), true
				}
				return float64(ready*1000000 + total), true
			case "age":
				return numericAgeSortValue(row.AgeTimestamp)
			default:
				return 0, false
			}
		},
	}
}

func (b *NamespaceWorkloadsBuilder) buildDeploymentSummary(
	clusterID string,
	deploy *appsv1.Deployment,
	podsByOwner map[string][]streamrows.PodAggregate,
	usage map[string]metrics.PodUsage,
) WorkloadSummary {
	var pods []streamrows.PodAggregate
	if deploy != nil {
		key := workloadOwnerKey(deployment.Identity.Kind, deploy.Namespace, deploy.Name)
		pods = podsByOwner[key]
	}
	resources := aggregateWorkloadPodResources(pods, usage)
	desired := int32(0)
	if deploy != nil && deploy.Spec.Replicas != nil {
		desired = *deploy.Spec.Replicas
	}
	ready := int32(0)
	if deploy != nil {
		ready = deploy.Status.ReadyReplicas
	}
	readyStatus := workloadPodReadyStatus(pods, ready, desired)
	model := deployment.BuildResourceModel(clusterID, deploy)

	return WorkloadSummary{
		Kind:                 deployment.Identity.Kind,
		Name:                 deploy.Name,
		Namespace:            deploy.Namespace,
		Ready:                readyStatus,
		Status:               model.Status.Label,
		StatusState:          model.Status.State,
		StatusPresentation:   model.Status.Presentation,
		StatusReason:         model.Status.Reason,
		Restarts:             resources.Restarts,
		Age:                  formatAge(deploy.CreationTimestamp.Time),
		AgeTimestamp:         creationTimestampMillis(deploy),
		CPUUsage:             formatWorkloadCPUMilli(resources.CPUUsageMilli),
		CPURequest:           formatWorkloadCPUMilli(resources.CPURequestMilli),
		CPULimit:             formatWorkloadCPUMilli(resources.CPULimitMilli),
		MemUsage:             formatWorkloadMemory(resources.MemoryUsageBytes),
		MemRequest:           formatWorkloadMemory(resources.MemoryRequestBytes),
		MemLimit:             formatWorkloadMemory(resources.MemoryLimitBytes),
		PortForwardAvailable: common.HasForwardableContainerPorts(deploy.Spec.Template.Spec.Containers),
		DesiredReplicas:      cloneInt32Ptr(deploy.Spec.Replicas),
	}
}

func (b *NamespaceWorkloadsBuilder) buildStatefulSetSummary(
	clusterID string,
	stateful *appsv1.StatefulSet,
	podsByOwner map[string][]streamrows.PodAggregate,
	usage map[string]metrics.PodUsage,
) WorkloadSummary {
	var pods []streamrows.PodAggregate
	if stateful != nil {
		key := workloadOwnerKey(statefulset.Identity.Kind, stateful.Namespace, stateful.Name)
		pods = podsByOwner[key]
	}
	resources := aggregateWorkloadPodResources(pods, usage)
	desired := int32(0)
	if stateful != nil && stateful.Spec.Replicas != nil {
		desired = *stateful.Spec.Replicas
	}
	ready := int32(0)
	if stateful != nil {
		ready = stateful.Status.ReadyReplicas
	}
	readyStatus := workloadPodReadyStatus(pods, ready, desired)
	model := statefulset.BuildResourceModel(clusterID, stateful)

	return WorkloadSummary{
		Kind:                 statefulset.Identity.Kind,
		Name:                 stateful.Name,
		Namespace:            stateful.Namespace,
		Ready:                readyStatus,
		Status:               model.Status.Label,
		StatusState:          model.Status.State,
		StatusPresentation:   model.Status.Presentation,
		StatusReason:         model.Status.Reason,
		Restarts:             resources.Restarts,
		Age:                  formatAge(stateful.CreationTimestamp.Time),
		AgeTimestamp:         creationTimestampMillis(stateful),
		CPUUsage:             formatWorkloadCPUMilli(resources.CPUUsageMilli),
		CPURequest:           formatWorkloadCPUMilli(resources.CPURequestMilli),
		CPULimit:             formatWorkloadCPUMilli(resources.CPULimitMilli),
		MemUsage:             formatWorkloadMemory(resources.MemoryUsageBytes),
		MemRequest:           formatWorkloadMemory(resources.MemoryRequestBytes),
		MemLimit:             formatWorkloadMemory(resources.MemoryLimitBytes),
		PortForwardAvailable: common.HasForwardableContainerPorts(stateful.Spec.Template.Spec.Containers),
		DesiredReplicas:      cloneInt32Ptr(stateful.Spec.Replicas),
	}
}

func (b *NamespaceWorkloadsBuilder) buildDaemonSetSummary(
	clusterID string,
	daemon *appsv1.DaemonSet,
	podsByOwner map[string][]streamrows.PodAggregate,
	usage map[string]metrics.PodUsage,
) WorkloadSummary {
	var pods []streamrows.PodAggregate
	if daemon != nil {
		key := workloadOwnerKey(daemonset.Identity.Kind, daemon.Namespace, daemon.Name)
		pods = podsByOwner[key]
	}
	resources := aggregateWorkloadPodResources(pods, usage)
	ready := int32(0)
	desired := int32(0)
	if daemon != nil {
		ready = daemon.Status.NumberReady
		desired = daemon.Status.DesiredNumberScheduled
	}
	readyStatus := workloadPodReadyStatus(pods, ready, desired)
	model := daemonset.BuildResourceModel(clusterID, daemon)

	return WorkloadSummary{
		Kind:                 daemonset.Identity.Kind,
		Name:                 daemon.Name,
		Namespace:            daemon.Namespace,
		Ready:                readyStatus,
		Status:               model.Status.Label,
		StatusState:          model.Status.State,
		StatusPresentation:   model.Status.Presentation,
		StatusReason:         model.Status.Reason,
		Restarts:             resources.Restarts,
		Age:                  formatAge(daemon.CreationTimestamp.Time),
		AgeTimestamp:         creationTimestampMillis(daemon),
		CPUUsage:             formatWorkloadCPUMilli(resources.CPUUsageMilli),
		CPURequest:           formatWorkloadCPUMilli(resources.CPURequestMilli),
		CPULimit:             formatWorkloadCPUMilli(resources.CPULimitMilli),
		MemUsage:             formatWorkloadMemory(resources.MemoryUsageBytes),
		MemRequest:           formatWorkloadMemory(resources.MemoryRequestBytes),
		MemLimit:             formatWorkloadMemory(resources.MemoryLimitBytes),
		PortForwardAvailable: common.HasForwardableContainerPorts(daemon.Spec.Template.Spec.Containers),
	}
}

func (b *NamespaceWorkloadsBuilder) buildJobSummary(
	clusterID string,
	job *batchv1.Job,
	podsByOwner map[string][]streamrows.PodAggregate,
	usage map[string]metrics.PodUsage,
) WorkloadSummary {
	var pods []streamrows.PodAggregate
	if job != nil {
		key := workloadOwnerKey(jobres.Identity.Kind, job.Namespace, job.Name)
		pods = podsByOwner[key]
	}
	resources := aggregateWorkloadPodResources(pods, usage)
	var desired int32 = 1
	if job != nil && job.Spec.Completions != nil {
		desired = *job.Spec.Completions
	}
	completed := int32(0)
	if job != nil {
		completed = job.Status.Succeeded
	}
	model := jobres.BuildResourceModel(clusterID, job)

	return WorkloadSummary{
		Kind:                 jobres.Identity.Kind,
		Name:                 job.Name,
		Namespace:            job.Namespace,
		Ready:                fmt.Sprintf("%d/%d", completed, desired),
		Status:               model.Status.Label,
		StatusState:          model.Status.State,
		StatusPresentation:   model.Status.Presentation,
		StatusReason:         model.Status.Reason,
		Restarts:             resources.Restarts,
		Age:                  formatAge(job.CreationTimestamp.Time),
		AgeTimestamp:         creationTimestampMillis(job),
		CPUUsage:             formatWorkloadCPUMilli(resources.CPUUsageMilli),
		CPURequest:           formatWorkloadCPUMilli(resources.CPURequestMilli),
		CPULimit:             formatWorkloadCPUMilli(resources.CPULimitMilli),
		MemUsage:             formatWorkloadMemory(resources.MemoryUsageBytes),
		MemRequest:           formatWorkloadMemory(resources.MemoryRequestBytes),
		MemLimit:             formatWorkloadMemory(resources.MemoryLimitBytes),
		PortForwardAvailable: common.HasForwardableContainerPorts(job.Spec.Template.Spec.Containers),
	}
}

func (b *NamespaceWorkloadsBuilder) buildCronJobSummary(
	clusterID string,
	cron *batchv1.CronJob,
	podsByOwner map[string][]streamrows.PodAggregate,
	usage map[string]metrics.PodUsage,
) WorkloadSummary {
	var pods []streamrows.PodAggregate
	if cron != nil {
		key := workloadOwnerKey(cronjob.Identity.Kind, cron.Namespace, cron.Name)
		pods = podsByOwner[key]
	}
	resources := aggregateWorkloadPodResources(pods, usage)
	active := 0
	if cron != nil {
		active = len(cron.Status.Active)
	}
	model := cronjob.BuildResourceModel(clusterID, cron)

	return WorkloadSummary{
		Kind:                 cronjob.Identity.Kind,
		Name:                 cron.Name,
		Namespace:            cron.Namespace,
		Ready:                fmt.Sprintf("%d", active),
		Status:               model.Status.Label,
		StatusState:          model.Status.State,
		StatusPresentation:   model.Status.Presentation,
		StatusReason:         model.Status.Reason,
		Restarts:             resources.Restarts,
		Age:                  formatAge(cron.CreationTimestamp.Time),
		AgeTimestamp:         creationTimestampMillis(cron),
		CPUUsage:             formatWorkloadCPUMilli(resources.CPUUsageMilli),
		CPURequest:           formatWorkloadCPUMilli(resources.CPURequestMilli),
		CPULimit:             formatWorkloadCPUMilli(resources.CPULimitMilli),
		MemUsage:             formatWorkloadMemory(resources.MemoryUsageBytes),
		MemRequest:           formatWorkloadMemory(resources.MemoryRequestBytes),
		MemLimit:             formatWorkloadMemory(resources.MemoryLimitBytes),
		PortForwardAvailable: common.HasForwardableContainerPorts(cron.Spec.JobTemplate.Spec.Template.Spec.Containers),
	}
}

func buildStandalonePodSummary(clusterID string, pod *corev1.Pod, usage map[string]metrics.PodUsage) WorkloadSummary {
	resources := aggregateWorkloadPodResources([]streamrows.PodAggregate{projectPodAggregate(pod, nil)}, usage)
	ready := podReadyStatus(pod)
	model := podres.BuildResourceModel(clusterID, pod)

	return WorkloadSummary{
		Kind:                 podres.Identity.Kind,
		Name:                 pod.Name,
		Namespace:            pod.Namespace,
		Ready:                ready,
		Status:               model.Status.Label,
		StatusState:          model.Status.State,
		StatusPresentation:   model.Status.Presentation,
		StatusReason:         model.Status.Reason,
		Restarts:             resources.Restarts,
		Age:                  formatAge(pod.CreationTimestamp.Time),
		AgeTimestamp:         creationTimestampMillis(pod),
		CPUUsage:             formatWorkloadCPUMilli(resources.CPUUsageMilli),
		CPURequest:           formatWorkloadCPUMilli(resources.CPURequestMilli),
		CPULimit:             formatWorkloadCPUMilli(resources.CPULimitMilli),
		MemUsage:             formatWorkloadMemory(resources.MemoryUsageBytes),
		MemRequest:           formatWorkloadMemory(resources.MemoryRequestBytes),
		MemLimit:             formatWorkloadMemory(resources.MemoryLimitBytes),
		PortForwardAvailable: hasForwardablePodPorts(pod),
	}
}

// buildStandalonePodSummaryFromRows builds the standalone-pod WorkloadSummary from the
// pod's projected ingest rows instead of the typed pod, byte-identically to
// buildStandalonePodSummary (proven in namespace_workloads_standalone_ingest_test.go):
//
//   - status (label/state/presentation/reason), name, namespace, ready, restarts, age,
//     ageTimestamp, and port-forward availability are read from the PodSummary (the
//     Table half), which carries exactly the same values BuildResourceModel/BuildFacts/
//     common.HasForwardableContainerPorts produced from the typed pod;
//   - the cpu/mem request/limit reservations are the PodAggregate's regular-container
//     int64 sums, re-formatted with the WORKLOAD formatters (not the PodSummary's
//     streamrows formatters), matching aggregateWorkloadPodResources;
//   - cpu/mem usage are the fresh metrics sample, formatted the same way.
//
// The caller has already excluded Succeeded/Failed pods, so the single-pod aggregate's
// restart total equals the PodSummary's RestartCount (BuildFacts) exactly.
func buildStandalonePodSummaryFromRows(podSummary streamrows.PodSummary, agg streamrows.PodAggregate, usage map[string]metrics.PodUsage) WorkloadSummary {
	sample := usage[fmt.Sprintf("%s/%s", agg.Namespace, agg.Name)]
	return WorkloadSummary{
		Kind:                 podres.Identity.Kind,
		Name:                 podSummary.Name,
		Namespace:            podSummary.Namespace,
		Ready:                podSummary.Ready,
		Status:               podSummary.Status,
		StatusState:          podSummary.StatusState,
		StatusPresentation:   podSummary.StatusPresentation,
		StatusReason:         podSummary.StatusReason,
		Restarts:             podSummary.Restarts,
		Age:                  podSummary.Age,
		AgeTimestamp:         podSummary.AgeTimestamp,
		CPUUsage:             formatWorkloadCPUMilli(sample.CPUUsageMilli),
		CPURequest:           formatWorkloadCPUMilli(agg.CPURequestMilli),
		CPULimit:             formatWorkloadCPUMilli(agg.CPULimitMilli),
		MemUsage:             formatWorkloadMemory(sample.MemoryUsageBytes),
		MemRequest:           formatWorkloadMemory(agg.MemRequestBytes),
		MemLimit:             formatWorkloadMemory(agg.MemLimitBytes),
		PortForwardAvailable: podSummary.PortForwardAvailable,
	}
}

type resourceTotals struct {
	CPURequestMilli    int64
	CPULimitMilli      int64
	CPUUsageMilli      int64
	MemoryRequestBytes int64
	MemoryLimitBytes   int64
	MemoryUsageBytes   int64
	Restarts           int32
}

func aggregateWorkloadPodResources(pods []streamrows.PodAggregate, usage map[string]metrics.PodUsage) resourceTotals {
	var totals resourceTotals
	for _, agg := range pods {
		if agg.Phase == string(corev1.PodSucceeded) || agg.Phase == string(corev1.PodFailed) {
			continue
		}

		totals.Restarts += agg.RestartCountFacts

		// Workloads sum REGULAR containers only (init containers excluded), which
		// the regular-container fields of the aggregate carry.
		totals.CPURequestMilli += agg.CPURequestMilli
		totals.MemoryRequestBytes += agg.MemRequestBytes
		totals.CPULimitMilli += agg.CPULimitMilli
		totals.MemoryLimitBytes += agg.MemLimitBytes

		key := fmt.Sprintf("%s/%s", agg.Namespace, agg.Name)
		if usageSample, ok := usage[key]; ok {
			totals.CPUUsageMilli += usageSample.CPUUsageMilli
			totals.MemoryUsageBytes += usageSample.MemoryUsageBytes
		}
	}
	return totals
}

func workloadOwnerKey(kind, namespace, name string) string {
	return fmt.Sprintf("%s/%s/%s", namespace, kind, name)
}

func ownerKeyForPod(pod *corev1.Pod) string {
	if pod == nil {
		return ""
	}
	for _, owner := range pod.OwnerReferences {
		if owner.Controller != nil && *owner.Controller {
			kind := owner.Kind
			name := owner.Name
			if owner.Kind == replicasetpkg.Identity.Kind {
				if base := deploymentNameFromReplicaSet(owner.Name); base != "" {
					kind = deployment.Identity.Kind
					name = base
				}
			}
			return workloadOwnerKey(kind, pod.Namespace, name)
		}
	}
	return ""
}

func deploymentNameFromReplicaSet(name string) string {
	if name == "" {
		return ""
	}
	idx := strings.LastIndex(name, "-")
	if idx <= 0 {
		return ""
	}
	return name[:idx]
}

func podReadyStatus(pod *corev1.Pod) string {
	if pod == nil {
		return "0/0"
	}
	agg := projectPodAggregate(pod, nil)
	return fmt.Sprintf("%d/%d", agg.ReadyContainers, agg.TotalContainers)
}

func workloadPodReadyStatus(pods []streamrows.PodAggregate, fallbackReady, fallbackTotal int32) string {
	readyPods := int32(0)
	totalPods := int32(0)
	for _, agg := range pods {
		if agg.Phase == string(corev1.PodSucceeded) || agg.Phase == string(corev1.PodFailed) {
			continue
		}
		totalPods++
		if agg.TotalContainers > 0 && agg.ReadyContainers >= agg.TotalContainers {
			readyPods++
		}
	}
	if totalPods == 0 && fallbackTotal > 0 {
		return fmt.Sprintf("%d/%d", fallbackReady, fallbackTotal)
	}
	return fmt.Sprintf("%d/%d", readyPods, totalPods)
}

// listHPAs lists HorizontalPodAutoscalers in the given namespace (or all if empty).
func (b *NamespaceWorkloadsBuilder) listHPAs(namespace string) ([]*autoscalingv1.HorizontalPodAutoscaler, error) {
	if b.hpaLister == nil {
		return nil, errors.New("hpa lister unavailable")
	}
	if namespace == "" {
		return b.hpaLister.List(labels.Everything())
	}
	return b.hpaLister.HorizontalPodAutoscalers(namespace).List(labels.Everything())
}

// buildHPATargetSet returns a set of full GVK + namespace/name keys for
// workloads targeted by a HorizontalPodAutoscaler.
func buildHPATargetSet(hpas []*autoscalingv1.HorizontalPodAutoscaler) map[string]struct{} {
	targets := make(map[string]struct{}, len(hpas))
	for _, hpa := range hpas {
		if hpa == nil {
			continue
		}
		ref := hpa.Spec.ScaleTargetRef
		gvk := schema.FromAPIVersionAndKind(ref.APIVersion, ref.Kind)
		if gvk.Empty() || strings.TrimSpace(ref.Name) == "" {
			continue
		}
		targets[hpaTargetKey(gvk.Group, gvk.Version, gvk.Kind, hpa.Namespace, ref.Name)] = struct{}{}
	}
	return targets
}

func workloadHPATargetKey(summary WorkloadSummary) string {
	switch summary.Kind {
	case deployment.Identity.Kind, statefulset.Identity.Kind, daemonset.Identity.Kind:
		return hpaTargetKey("apps", "v1", summary.Kind, summary.Namespace, summary.Name)
	case jobres.Identity.Kind, cronjob.Identity.Kind:
		return hpaTargetKey("batch", "v1", summary.Kind, summary.Namespace, summary.Name)
	case podres.Identity.Kind:
		return hpaTargetKey("", "v1", summary.Kind, summary.Namespace, summary.Name)
	default:
		return hpaTargetKey("", "", summary.Kind, summary.Namespace, summary.Name)
	}
}

func hpaTargetKey(group, version, kind, namespace, name string) string {
	return fmt.Sprintf("%s/%s/%s/%s/%s", group, version, kind, namespace, name)
}

func cloneInt32Ptr(value *int32) *int32 {
	if value == nil {
		return nil
	}
	clone := *value
	return &clone
}

func formatWorkloadCPUMilli(value int64) string {
	if value <= 0 {
		return "-"
	}
	if value < 1000 {
		return fmt.Sprintf("%dm", value)
	}
	return fmt.Sprintf("%.2f", float64(value)/1000)
}

func formatWorkloadMemory(value int64) string {
	if value <= 0 {
		return "-"
	}
	const (
		ki = 1024
		mi = ki * 1024
		gi = mi * 1024
	)
	if value >= gi {
		return fmt.Sprintf("%.2fGi", float64(value)/float64(gi))
	}
	if value >= mi {
		return fmt.Sprintf("%.0fMi", float64(value)/float64(mi))
	}
	if value >= ki {
		return fmt.Sprintf("%.0fKi", float64(value)/float64(ki))
	}
	return fmt.Sprintf("%d", value)
}
