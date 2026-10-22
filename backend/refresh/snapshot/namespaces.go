package snapshot

import (
	"context"
	"hash/fnv"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	apimachineryerrors "k8s.io/apimachinery/pkg/api/errors"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/kubernetes"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/kind/objectmapnode"
	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/objectcatalog"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
	"github.com/luxury-yacht/app/backend/refresh/doorbell"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	namespacepkg "github.com/luxury-yacht/app/backend/resources/namespaces"
	resourcequotapkg "github.com/luxury-yacht/app/backend/resources/resourcequota"
)

var ResourceQuotaGVR = schema.GroupVersionResource{Group: resourcequotapkg.Identity.Group, Version: resourcequotapkg.Identity.Version, Resource: resourcequotapkg.Identity.Resource}

// NamespaceBuilder constructs namespace snapshots from the owned namespace
// reflector's store, joined at serve with workload presence from the pod and
// workload ingest stores, warning events, and quota pressure.
type NamespaceBuilder struct {
	namespaces namespaceProvider
	// events is the owned events store the warning rollup counts.
	// eventsExpected is true only when the identity may list and watch
	// Events. A denied source is unavailable, while an allowed source that has
	// not synced yet is loading.
	events         namespaceEventSource
	eventsExpected bool
	ingest         namespacePodIngestSource
	tracker        *NamespaceWorkloadTracker
	// scope is the cluster's configured namespace scope
	// (docs/architecture/namespace-scope.md). Non-empty means the rows are
	// synthesized from these names instead of read from the (cluster-wide,
	// permission-gated) namespace store.
	scope []string

	// client backs the scoped-mode per-namespace GET probe that enriches
	// rows and flags configured names the identity cannot reach. nil (the
	// unscoped path, unit tests) disables probing.
	client kubernetes.Interface
	// now/probeTTL are injectable for tests; zero values mean time.Now and
	// the permission-cache TTL.
	now      func() time.Time
	probeTTL time.Duration

	probeMu sync.Mutex
	probes  map[string]namespaceProbe
}

// Scope-probe outcomes surfaced on NamespaceSummary.ScopeStatus. A permitted
// GET returning 404 is definitive ("not-found"); a 403 stays honest — a
// restricted identity cannot distinguish a missing namespace from a denied
// one ("no-access").
type NamespaceScopeStatus string

const (
	NamespaceScopeStatusNotFound NamespaceScopeStatus = "not-found"
	NamespaceScopeStatusNoAccess NamespaceScopeStatus = "no-access"
)

// namespaceProbe caches one configured name's GET outcome: the real object
// when it exists and is readable, else the flag; checkedAt drives the TTL.
type namespaceProbe struct {
	ns        *corev1.Namespace
	status    NamespaceScopeStatus
	checkedAt time.Time
}

// probeScopedNamespace resolves one configured name: the real namespace
// object (row enrichment) or a flag. Results are TTL-cached so builds do not
// issue one GET per name per refresh tick; a transient error serves the
// previous result (or nothing) rather than flapping a flag.
func (b *NamespaceBuilder) probeScopedNamespace(ctx context.Context, name string) (*corev1.Namespace, NamespaceScopeStatus) {
	if b.client == nil {
		return nil, ""
	}
	nowFn := b.now
	if nowFn == nil {
		nowFn = time.Now
	}
	ttl := b.probeTTL
	if ttl <= 0 {
		ttl = config.PermissionCacheTTL
	}
	b.probeMu.Lock()
	if probe, ok := b.probes[name]; ok && nowFn().Sub(probe.checkedAt) < ttl {
		b.probeMu.Unlock()
		return probe.ns, probe.status
	}
	b.probeMu.Unlock()

	got, err := b.client.CoreV1().Namespaces().Get(ctx, name, metav1.GetOptions{})
	var probe namespaceProbe
	switch {
	case err == nil:
		probe = namespaceProbe{ns: got}
	case apimachineryerrors.IsNotFound(err):
		probe = namespaceProbe{status: NamespaceScopeStatusNotFound}
	case apimachineryerrors.IsForbidden(err):
		probe = namespaceProbe{status: NamespaceScopeStatusNoAccess}
	default:
		b.probeMu.Lock()
		previous, ok := b.probes[name]
		b.probeMu.Unlock()
		if ok {
			return previous.ns, previous.status
		}
		return nil, ""
	}
	probe.checkedAt = nowFn()
	b.probeMu.Lock()
	if b.probes == nil {
		b.probes = make(map[string]namespaceProbe)
	}
	b.probes[name] = probe
	b.probeMu.Unlock()
	return probe.ns, probe.status
}

// scopeProbeSignature fingerprints the per-name probe flags so a flag
// transition (a namespace created, deleted, or newly accessible) changes the
// snapshot's cache validator — synthesized rows carry no RV clock to do it.
func scopeProbeSignature(statuses map[string]NamespaceScopeStatus) string {
	names := make([]string, 0, len(statuses))
	for name := range statuses {
		names = append(names, name)
	}
	sort.Strings(names)
	h := fnv.New64a()
	for _, name := range names {
		_, _ = h.Write([]byte(name))
		_, _ = h.Write([]byte{'='})
		_, _ = h.Write([]byte(statuses[name]))
		_, _ = h.Write([]byte{0})
	}
	return strconv.FormatUint(h.Sum64(), 16)
}

// namespacePodIngestSource is the ingest surface the namespace domain reads: the per-kind
// settlement and concrete data-readiness state used by NewNamespaceWorkloadTracker, plus the
// projected rows the per-build workload-presence set is computed from (the cut workload kinds'
// Catalog rows and the pod and ResourceQuota kinds' Aggregate rows).
type namespacePodIngestSource interface {
	Tracks(gvr schema.GroupVersionResource) bool
	HasSyncedFor(gvr schema.GroupVersionResource) bool
	RawHasSyncedFor(gvr schema.GroupVersionResource) bool
	PermissionSkippedFor(gvr schema.GroupVersionResource) bool
	CatalogRows(gvr schema.GroupVersionResource) []interface{}
	AggregateRows(gvr schema.GroupVersionResource) []interface{}
	ObjectMapRows(gvr schema.GroupVersionResource) []interface{}
}

// NamespaceSnapshot payload returned to clients.
type NamespaceSnapshot struct {
	ClusterMeta
	Namespaces []NamespaceSummary `json:"namespaces"`
	// WorkloadReadiness is the backend-internal startup state of the pod + workload sources.
	// It is not serialized: rows expose uncertainty through workloadsUnknown, while the aggregate
	// lifecycle consumes this typed state to distinguish pending, degraded, and ready.
	WorkloadReadiness NamespaceWorkloadReadiness `json:"-"`
}

// NamespaceSummary provides high level namespace metadata.
type NamespaceSummary struct {
	Ref                        resourcemodel.ResourceRef            `json:"ref"`
	Metadata                   *resourcemodel.ResourceTableMetadata `json:"metadata,omitempty"`
	Phase                      string                               `json:"phase"`
	Status                     string                               `json:"status,omitempty"`
	StatusState                string                               `json:"statusState,omitempty"`
	StatusPresentation         string                               `json:"statusPresentation,omitempty"`
	StatusReason               string                               `json:"statusReason,omitempty"`
	ResourceVersion            string                               `json:"resourceVersion"`
	CreationUnix               int64                                `json:"creationTimestamp"`
	HasWorkloads               bool                                 `json:"hasWorkloads"`
	WorkloadsUnknown           bool                                 `json:"workloadsUnknown,omitempty"`
	UnhealthyWorkloads         int                                  `json:"unhealthyWorkloads,omitempty"`
	WarningEvents              int                                  `json:"warningEvents,omitempty"`
	WarningEventsState         NamespaceSignalState                 `json:"warningEventsState"`
	CPURequestsMilli           int64                                `json:"cpuRequestsMilli,omitempty"`
	CPULimitsMilli             int64                                `json:"cpuLimitsMilli,omitempty"`
	MemoryRequestsBytes        int64                                `json:"memoryRequestsBytes,omitempty"`
	MemoryLimitsBytes          int64                                `json:"memoryLimitsBytes,omitempty"`
	QuotaCount                 int                                  `json:"quotaCount,omitempty"`
	QuotaHighestUsedPercentage int                                  `json:"quotaHighestUsedPercentage,omitempty"`
	QuotaPressure              NamespaceQuotaPressure               `json:"quotaPressure,omitempty"`
	QuotaPressureState         NamespaceSignalState                 `json:"quotaPressureState"`
	// ScopeStatus flags a configured scope entry the identity cannot reach:
	// "not-found" (definitive) or "no-access" (may not exist). Empty for
	// reachable namespaces and for every unscoped row.
	ScopeStatus NamespaceScopeStatus `json:"scopeStatus,omitempty"`
}

// NamespaceSignalState reports whether an optional namespace aggregate is
// authoritative, still warming, or unavailable for this cluster identity.
type NamespaceSignalState string

const (
	NamespaceSignalAvailable   NamespaceSignalState = "available"
	NamespaceSignalLoading     NamespaceSignalState = "loading"
	NamespaceSignalUnavailable NamespaceSignalState = "unavailable"
)

// NamespaceQuotaPressure is backend-owned presentation semantics for the
// strongest ResourceQuota utilization observed in a namespace.
type NamespaceQuotaPressure string

const (
	NamespaceQuotaPressureNone     NamespaceQuotaPressure = ""
	NamespaceQuotaPressureWarning  NamespaceQuotaPressure = "warning"
	NamespaceQuotaPressureCritical NamespaceQuotaPressure = "critical"
)

const namespaceQuotaWarningPercentage = 80

// NamespaceDomainOptions configures the namespaces domain for the cluster's access.
type NamespaceDomainOptions struct {
	// AllowedNamespaces, when set, scopes the list to configured namespaces
	// instead of the cluster-wide namespaces LIST.
	AllowedNamespaces []string
	// Client probes configured namespaces by name; used only when scoped.
	Client kubernetes.Interface
	// EventsExpected is true only when the identity may list and watch Events.
	EventsExpected bool
}

// RegisterNamespaceDomain registers the namespace domain with the registry. Namespaces and the
// workload + pod kinds' projected rows come from the ingest manager (read per build); the
// tracker only gates the workload read on those stores having synced. ingestManager may be nil
// in a unit test.
//
// It returns the change notifier that replaces the frontend's namespaces poll: namespace,
// workload, pod, quota, and event ingest changes feed it (sinks registered HERE, before the
// ingest manager starts). It rings bell, then calls afterRing.
func RegisterNamespaceDomain(
	reg *domain.Registry,
	ingestManager namespacePodIngestSource,
	options NamespaceDomainOptions,
	bell doorbell.Bell,
	afterRing func(version, reason string),
) (*NamespaceChangeNotifier, error) {
	tracker := NewNamespaceWorkloadTracker(ingestManager)
	builder := newNamespaceDomainBuilder(ingestManager, tracker, options.AllowedNamespaces, options.Client)
	notifier := NewNamespaceChangeNotifier(ingestManager, tracker, bell, afterRing)
	wireNamespaceEvents(ingestManager, builder, notifier, options.EventsExpected)
	wireNamespaceIngestSinks(ingestManager, builder, notifier)
	return registerNamespaceSnapshotBuilder(reg, builder, notifier)
}

func newNamespaceDomainBuilder(
	ingestManager namespacePodIngestSource,
	tracker *NamespaceWorkloadTracker,
	allowedNamespaces []string,
	client kubernetes.Interface,
) *NamespaceBuilder {
	builder := &NamespaceBuilder{
		ingest:  ingestManager,
		tracker: tracker,
		scope:   append([]string(nil), allowedNamespaces...),
	}
	if len(builder.scope) > 0 {
		// The probe client is scoped-mode only: unscoped rows come from the
		// lister and must not issue per-name GETs.
		builder.client = client
	}
	return builder
}

// wireNamespaceEvents feeds the warning rollup from the owned events store
// when the identity may read Events. The store's sink tells the notifier to
// recount; the builder counts at serve.
func wireNamespaceEvents(
	ingestManager namespacePodIngestSource,
	builder *NamespaceBuilder,
	notifier *NamespaceChangeNotifier,
	eventsExpected bool,
) {
	events, ok := ingestManager.(interface {
		namespaceEventSource
		AddBundleSink(gvr schema.GroupVersionResource, sink ingest.BundleSink) bool
	})
	if !eventsExpected || !ok || !events.AddBundleSink(EventGVR, namespaceEventSink{notifier: notifier}) {
		return
	}
	builder.events = events
	builder.eventsExpected = true
	notifier.events = events
	notifier.eventsExpected = true
}

func wireNamespaceIngestSinks(ingestManager namespacePodIngestSource, builder *NamespaceBuilder, notifier *NamespaceChangeNotifier) {
	// Bundle sinks fire on every Upsert/Delete/Replace for their GVR, which is all
	// the notifier needs: the flush decides via the presence signature whether the
	// event actually flipped a namespace's workload presence. AddBundleSink returns
	// false for an untracked GVR (permission-skipped) — those kinds then simply
	// never contribute events, matching the builder's per-build read.
	sinks, ok := ingestManager.(interface {
		AddBundleSink(gvr schema.GroupVersionResource, sink ingest.BundleSink) bool
	})
	if !ok {
		return
	}
	for _, gvr := range trackedWorkloadGVRs {
		sinks.AddBundleSink(gvr, namespaceNotifierSink{notifier: notifier})
	}
	sinks.AddBundleSink(ResourceQuotaGVR, namespaceQuotaNotifierSink{notifier: notifier})
	// Scoped clusters synthesize rows from the configured names, so namespace
	// changes cannot alter the row set: it changes only through a
	// settings-triggered subsystem rebuild.
	if len(builder.scope) == 0 {
		builder.namespaces = ingestNamespaces{ingest: ingestManager}
		sinks.AddBundleSink(NamespaceGVR, namespaceObjectSink{notifier: notifier})
	}
}

func registerNamespaceSnapshotBuilder(
	reg *domain.Registry,
	builder *NamespaceBuilder,
	notifier *NamespaceChangeNotifier,
) (*NamespaceChangeNotifier, error) {
	if err := reg.Register(refresh.DomainConfig{
		Name:          "namespaces",
		BuildSnapshot: builder.Build,
		// Scoped rows are synthesized from configuration: no cluster
		// permission is needed, so BOTH permission gates (registration-time
		// and the snapshot service's per-request check) must stand down.
		RuntimePolicyExempt: len(builder.scope) > 0,
	}); err != nil {
		return nil, err
	}
	return notifier, nil
}

// namespaceNotifierSink adapts the change notifier to the ingest BundleSink (and
// bulk Replace) contract: every delivery is just "a workload event happened".
type namespaceNotifierSink struct {
	notifier *NamespaceChangeNotifier
}

func (s namespaceNotifierSink) UpsertBundle(ingest.Bundle)     { s.notifier.WorkloadChanged() }
func (s namespaceNotifierSink) DeleteBundle(ingest.Bundle)     { s.notifier.WorkloadChanged() }
func (s namespaceNotifierSink) ReplaceBundles([]ingest.Bundle) { s.notifier.WorkloadChanged() }

type namespaceQuotaNotifierSink struct {
	notifier *NamespaceChangeNotifier
}

func (s namespaceQuotaNotifierSink) UpsertBundle(ingest.Bundle)     { s.notifier.QuotaChanged() }
func (s namespaceQuotaNotifierSink) DeleteBundle(ingest.Bundle)     { s.notifier.QuotaChanged() }
func (s namespaceQuotaNotifierSink) ReplaceBundles([]ingest.Bundle) { s.notifier.QuotaChanged() }

type namespaceBuildInputs struct {
	meta              ClusterMeta
	namespaces        []*corev1.Namespace
	scopeStatuses     map[string]NamespaceScopeStatus
	workloadReadiness NamespaceWorkloadReadiness
	workloadRollups   namespaceWorkloadRollups
	warningEvents     warningEventRollup
	quotaRollups      map[string]namespaceQuotaRollup
	quotaState        NamespaceSignalState
}

// Build returns the namespace snapshot payload.
func (b *NamespaceBuilder) Build(ctx context.Context, scope string) (*refresh.Snapshot, error) {
	meta := ClusterMetaFromContext(ctx)
	namespaces, scopeStatuses, err := b.collectNamespaces(ctx)
	if err != nil {
		return nil, err
	}
	sortNamespaces(namespaces)
	workloadReadiness := b.workloadTrackerReadiness()
	workloadRollups := namespaceWorkloadRollupsFromIngest(b.ingest)
	warningEvents := b.warningEventRollups()
	quotaRollups, quotaState := namespaceQuotaRollupsFromIngest(b.ingest)
	inputs := namespaceBuildInputs{
		meta:              meta,
		namespaces:        namespaces,
		scopeStatuses:     scopeStatuses,
		workloadReadiness: workloadReadiness,
		workloadRollups:   workloadRollups,
		warningEvents:     warningEvents,
		quotaRollups:      quotaRollups,
		quotaState:        quotaState,
	}
	items, version := b.buildNamespaceSummaries(inputs)
	return b.namespaceSnapshot(scope, inputs, items, version), nil
}

// collectNamespaces lists the cluster's namespaces, or probes the configured
// namespace scope when one restricts the cluster.
func (b *NamespaceBuilder) collectNamespaces(ctx context.Context) ([]*corev1.Namespace, map[string]NamespaceScopeStatus, error) {
	if len(b.scope) > 0 {
		return b.collectScopedNamespaces(ctx)
	}
	if b.namespaces == nil {
		return nil, map[string]NamespaceScopeStatus{}, nil
	}
	return b.namespaces.Namespaces(), map[string]NamespaceScopeStatus{}, nil
}

func (b *NamespaceBuilder) collectScopedNamespaces(ctx context.Context) ([]*corev1.Namespace, map[string]NamespaceScopeStatus, error) {
	var namespaces []*corev1.Namespace
	statuses := make(map[string]NamespaceScopeStatus)
	for _, name := range b.scope {
		probed, status := b.probeScopedNamespace(ctx, name)
		statuses[name] = status
		if probed == nil {
			probed = &corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: name}}
		}
		namespaces = append(namespaces, probed)
	}
	return namespaces, statuses, nil
}

func sortNamespaces(namespaces []*corev1.Namespace) {
	if len(namespaces) > 1 {
		sort.Slice(namespaces, func(i, j int) bool {
			return namespaces[i].Name < namespaces[j].Name
		})
	}
}

func (b *NamespaceBuilder) workloadTrackerReadiness() NamespaceWorkloadReadiness {
	if b.tracker == nil {
		return NamespaceWorkloadReady
	}
	// Non-blocking: read whether the cut workload + pod ingest stores have synced rather than
	// waiting on them. The namespace list must paint without blocking on the pod/workload initial
	// LIST. Positive workload rows are usable immediately; a namespace's absence of workloads is
	// authoritative only once the tracked stores actually sync or are permission-skipped, so
	// before then it is reported as not-yet-known and the workload-presence source clock
	// re-delivers the corrected snapshot.
	return b.tracker.Readiness()
}

func (b *NamespaceBuilder) buildNamespaceSummaries(inputs namespaceBuildInputs) ([]NamespaceSummary, uint64) {
	workloadNamespaces := inputs.workloadRollups.namespaces
	items := make([]NamespaceSummary, 0, len(inputs.namespaces))
	var version uint64
	for _, ns := range inputs.namespaces {
		_, hasWorkloads := workloadNamespaces[ns.Name]
		reservations := inputs.workloadRollups.reservations[ns.Name]
		quota := inputs.quotaRollups[ns.Name]
		// In scoped mode a tracker that latched synced because NOTHING is
		// tracked (every workload kind permission-skipped) means presence is
		// genuinely unknown — reporting it as authoritative would dim every
		// configured namespace. Unscoped behavior is unchanged.
		workloadsKnown := hasWorkloads || (inputs.workloadReadiness == NamespaceWorkloadReady && (len(b.scope) == 0 || b.tracksAnyWorkloadKind()))
		model := namespacepkg.BuildResourceModel(inputs.meta.ClusterID, ns, hasWorkloads, workloadsKnown)
		facts := namespacepkg.BuildFacts(inputs.meta.ClusterID, ns, hasWorkloads, workloadsKnown, nil, nil, resourcemodel.ResourceModelBuildOptions{})
		items = append(items, NamespaceSummary{
			Ref:                        model.Ref,
			Metadata:                   streamrows.NewResourceMetadata(ns),
			Phase:                      model.Status.State,
			Status:                     model.Status.Label,
			StatusState:                model.Status.State,
			StatusPresentation:         model.Status.Presentation,
			StatusReason:               model.Status.Reason,
			ResourceVersion:            model.Metadata.ResourceVersion,
			CreationUnix:               model.Metadata.CreationTimestamp.Unix(),
			HasWorkloads:               facts.HasWorkloads,
			WorkloadsUnknown:           !facts.WorkloadsKnown,
			UnhealthyWorkloads:         inputs.workloadRollups.unhealthy[ns.Name],
			WarningEvents:              inputs.warningEvents.counts[ns.Name],
			WarningEventsState:         inputs.warningEvents.state(ns.Name),
			CPURequestsMilli:           reservations.cpuRequestsMilli,
			CPULimitsMilli:             reservations.cpuLimitsMilli,
			MemoryRequestsBytes:        reservations.memoryRequestsBytes,
			MemoryLimitsBytes:          reservations.memoryLimitsBytes,
			QuotaCount:                 quota.count,
			QuotaHighestUsedPercentage: quota.highestUsedPercentage,
			QuotaPressure:              namespaceQuotaPressure(quota.highestUsedPercentage),
			QuotaPressureState:         inputs.quotaState,
			ScopeStatus:                inputs.scopeStatuses[ns.Name],
		})
		if v := parseResourceVersion(ns); v > version {
			version = v
		}
	}
	return items, version
}

func (b *NamespaceBuilder) namespaceSnapshot(
	scope string,
	inputs namespaceBuildInputs,
	items []NamespaceSummary,
	version uint64,
) *refresh.Snapshot {
	snapshot := &refresh.Snapshot{
		Domain:  "namespaces",
		Scope:   scope,
		Version: version,
		Payload: NamespaceSnapshot{ClusterMeta: inputs.meta, Namespaces: items, WorkloadReadiness: inputs.workloadReadiness},
		Stats: refresh.SnapshotStats{
			ItemCount: len(items),
		},
		// The per-namespace workload flag is content that the namespace resourceVersions
		// (Version, the "object" source clock) do NOT capture — a workload added/removed changes
		// presence without changing any namespace's RV, and the empty→populated transition as the
		// ingest stores sync is exactly such a change. Publish the workload-presence set as its
		// own source clock so the cache validator (SourceVersion) changes when presence or
		// readiness changes; otherwise an unchanged validator makes the delivery layer return
		// 304 Not Modified and the client keeps a stale (e.g. the first, pre-sync) snapshot.
		SourceVersions: map[string]string{
			"workloads":      workloadRollupSignature(inputs.workloadRollups, inputs.workloadReadiness),
			"warning-events": inputs.warningEvents.signature(),
			"quota-pressure": namespaceQuotaRollupSignature(inputs.quotaRollups, inputs.quotaState),
		},
	}
	if len(b.scope) > 0 {
		// Probe flags are content the namespace RV clock cannot carry (a
		// flagged row has no RV at all) — publish them as their own source
		// clock so transitions are delivered instead of 304'd.
		snapshot.SourceVersions["scope-probe"] = scopeProbeSignature(inputs.scopeStatuses)
	}
	return snapshot
}

// namespaceEventSource is the owned events store the namespace list counts
// warnings from, with the partition readiness that says which namespaces its
// watch covers.
type namespaceEventSource interface {
	eventStore
	partitionReadinessReporter
}

// warningEventRollup is one read of the Warning Event counts per involved
// namespace and the Event partitions behind them. A scoped identity may read
// Events in only some namespaces, so availability is per namespace.
type warningEventRollup struct {
	counts     map[string]int
	partitions []ingest.PartitionReadiness
}

func (b *NamespaceBuilder) warningEventRollups() warningEventRollup {
	return namespaceWarningEventRollups(b.events, b.eventsExpected)
}

func namespaceWarningEventRollups(events namespaceEventSource, eventsExpected bool) warningEventRollup {
	rollup := warningEventRollup{counts: make(map[string]int)}
	if !eventsExpected || events == nil {
		return rollup
	}
	rollup.partitions = events.PartitionReadinessFor(EventGVR)
	available := make(map[string]bool)
	visitStoredEvents(events, func(_ ingest.Bundle, fact *EventFact) {
		namespace := strings.TrimSpace(fact.InvolvedNamespace)
		if namespace == "" || !strings.EqualFold(fact.Type, corev1.EventTypeWarning) {
			return
		}
		counted, known := available[namespace]
		if !known {
			counted = rollup.state(namespace) == NamespaceSignalAvailable
			available[namespace] = counted
		}
		if counted {
			rollup.counts[namespace]++
		}
	})
	return rollup
}

// state reports namespace's warning-event availability from the Event
// partitions covering it. Every covering partition must be Ready for the count
// to be authoritative, and a namespace no partition covers has no Event watch.
func (r warningEventRollup) state(namespace string) NamespaceSignalState {
	state := NamespaceSignalUnavailable
	for _, part := range r.partitions {
		if part.Namespace != "" && part.Namespace != namespace {
			continue
		}
		switch part.State {
		case refresh.ResourceReadinessUnavailable:
			return NamespaceSignalUnavailable
		case refresh.ResourceReadinessReady:
			if state == NamespaceSignalUnavailable {
				state = NamespaceSignalAvailable
			}
		default:
			state = NamespaceSignalLoading
		}
	}
	return state
}

// signature changes whenever a count or a partition's readiness changes, so the
// namespace list re-delivers either.
func (r warningEventRollup) signature() string {
	partitions := make([]string, 0, len(r.partitions))
	for _, part := range r.partitions {
		partitions = append(partitions, part.Namespace+"="+strconv.Itoa(int(part.State)))
	}
	sort.Strings(partitions)
	names := make([]string, 0, len(r.counts))
	for namespace := range r.counts {
		names = append(names, namespace)
	}
	sort.Strings(names)
	h := fnv.New64a()
	for _, partition := range partitions {
		_, _ = h.Write([]byte(partition))
		_, _ = h.Write([]byte{0})
	}
	_, _ = h.Write([]byte{1})
	for _, namespace := range names {
		_, _ = h.Write([]byte(namespace))
		_, _ = h.Write([]byte{'='})
		_, _ = h.Write([]byte(strconv.Itoa(r.counts[namespace])))
		_, _ = h.Write([]byte{0})
	}
	return strconv.FormatUint(h.Sum64(), 16)
}

type namespaceQuotaRollup struct {
	count                 int
	highestUsedPercentage int
}

type namespaceQuotaIngestState interface {
	RawHasSyncedFor(gvr schema.GroupVersionResource) bool
	PermissionSkippedFor(gvr schema.GroupVersionResource) bool
}

func namespaceQuotaRollupsFromIngest(source namespacePodIngestSource) (map[string]namespaceQuotaRollup, NamespaceSignalState) {
	rollups := make(map[string]namespaceQuotaRollup)
	state := namespaceQuotaIngestSignalState(source)
	if state != NamespaceSignalAvailable {
		return rollups, state
	}
	for _, row := range source.AggregateRows(ResourceQuotaGVR) {
		aggregate, ok := row.(streamrows.ResourceQuotaAggregate)
		if !ok || aggregate.Namespace == "" {
			continue
		}
		rollup := rollups[aggregate.Namespace]
		rollup.count++
		if aggregate.HighestUsedPercentage > rollup.highestUsedPercentage {
			rollup.highestUsedPercentage = aggregate.HighestUsedPercentage
		}
		rollups[aggregate.Namespace] = rollup
	}
	return rollups, NamespaceSignalAvailable
}

func namespaceQuotaIngestSignalState(source namespacePodIngestSource) NamespaceSignalState {
	if source == nil || !source.Tracks(ResourceQuotaGVR) {
		return NamespaceSignalUnavailable
	}
	stateSource, exposesRawState := source.(namespaceQuotaIngestState)
	if !exposesRawState {
		if !source.HasSyncedFor(ResourceQuotaGVR) {
			return NamespaceSignalLoading
		}
		return NamespaceSignalAvailable
	}
	if stateSource.PermissionSkippedFor(ResourceQuotaGVR) {
		return NamespaceSignalUnavailable
	}
	if stateSource.RawHasSyncedFor(ResourceQuotaGVR) {
		return NamespaceSignalAvailable
	}
	if source.HasSyncedFor(ResourceQuotaGVR) {
		return NamespaceSignalUnavailable
	}
	return NamespaceSignalLoading
}

func namespaceQuotaPressure(highestUsedPercentage int) NamespaceQuotaPressure {
	switch {
	case highestUsedPercentage >= 100:
		return NamespaceQuotaPressureCritical
	case highestUsedPercentage >= namespaceQuotaWarningPercentage:
		return NamespaceQuotaPressureWarning
	default:
		return NamespaceQuotaPressureNone
	}
}

func namespaceQuotaRollupSignature(rollups map[string]namespaceQuotaRollup, state NamespaceSignalState) string {
	namespaces := make([]string, 0, len(rollups))
	for namespace := range rollups {
		namespaces = append(namespaces, namespace)
	}
	sort.Strings(namespaces)
	h := fnv.New64a()
	_, _ = h.Write([]byte(state))
	_, _ = h.Write([]byte{0})
	for _, namespace := range namespaces {
		rollup := rollups[namespace]
		_, _ = h.Write([]byte(namespace))
		_, _ = h.Write([]byte{'='})
		_, _ = h.Write([]byte(strconv.Itoa(rollup.count)))
		_, _ = h.Write([]byte{'/'})
		_, _ = h.Write([]byte(strconv.Itoa(rollup.highestUsedPercentage)))
		_, _ = h.Write([]byte{0})
	}
	return strconv.FormatUint(h.Sum64(), 16)
}

// workloadRollupSignature is a stable fingerprint of namespace workload
// presence, health, and active-pod reservations plus whether empty absence is
// authoritative yet. Namespace resourceVersions do not capture those values,
// so every rollup change needs a new snapshot validator.
func workloadRollupSignature(rollups namespaceWorkloadRollups, readiness NamespaceWorkloadReadiness) string {
	names := make([]string, 0, len(rollups.namespaces)+len(rollups.unhealthy)+len(rollups.reservations))
	seen := make(map[string]struct{}, len(rollups.namespaces)+len(rollups.unhealthy)+len(rollups.reservations))
	for ns := range rollups.namespaces {
		seen[ns] = struct{}{}
	}
	for ns := range rollups.unhealthy {
		seen[ns] = struct{}{}
	}
	for ns := range rollups.reservations {
		seen[ns] = struct{}{}
	}
	for ns := range seen {
		names = append(names, ns)
	}
	sort.Strings(names)
	h := fnv.New64a()
	_, _ = h.Write([]byte(readiness.String()))
	_, _ = h.Write([]byte{0})
	for _, ns := range names {
		_, _ = h.Write([]byte(ns))
		_, _ = h.Write([]byte{'='})
		_, _ = h.Write([]byte(strconv.Itoa(rollups.unhealthy[ns])))
		reservations := rollups.reservations[ns]
		for _, value := range []int64{
			reservations.cpuRequestsMilli,
			reservations.cpuLimitsMilli,
			reservations.memoryRequestsBytes,
			reservations.memoryLimitsBytes,
		} {
			_, _ = h.Write([]byte{'/'})
			_, _ = h.Write([]byte(strconv.FormatInt(value, 10)))
		}
		_, _ = h.Write([]byte{0})
	}
	return strconv.FormatUint(h.Sum64(), 16)
}

// tracksAnyWorkloadKind reports whether the ingest manager runs a reflector for
// at least one workload/pod kind — i.e. whether workload presence is knowable
// at all for this identity. False when every workload kind was
// permission-skipped (or there is no ingest), which in scoped mode must read
// as "unknown", never as "authoritatively empty".
func (b *NamespaceBuilder) tracksAnyWorkloadKind() bool {
	if b.ingest == nil {
		return false
	}
	for _, gvr := range trackedWorkloadGVRs {
		if b.ingest.Tracks(gvr) {
			return true
		}
	}
	return false
}

type namespaceWorkloadRollups struct {
	namespaces   map[string]struct{}
	unhealthy    map[string]int
	reservations map[string]namespaceResourceReservations
}

type namespaceResourceReservations struct {
	cpuRequestsMilli    int64
	cpuLimitsMilli      int64
	memoryRequestsBytes int64
	memoryLimitsBytes   int64
}

// namespaceWorkloadRollupsFromIngest computes namespace workload presence,
// health, and active-pod regular-container reservations from retained ingest
// projections. Controller health comes from the object-map half. Pod health
// counts only non-terminal ownerless pods because controller-owned pods are
// folded into their workload row; reservations include every non-terminal pod
// so they match the namespace's scheduled workload demand.
func namespaceWorkloadRollupsFromIngest(ingest namespacePodIngestSource) namespaceWorkloadRollups {
	rollups := namespaceWorkloadRollups{
		namespaces:   make(map[string]struct{}),
		unhealthy:    make(map[string]int),
		reservations: make(map[string]namespaceResourceReservations),
	}
	if ingest == nil {
		return rollups
	}
	for _, gvr := range []schema.GroupVersionResource{
		DeploymentGVR, StatefulSetGVR, DaemonSetGVR, JobGVR, CronJobGVR,
	} {
		addNamespaceWorkloadObjectRollups(&rollups, ingest, gvr)
	}
	addNamespacePodRollups(&rollups, ingest.AggregateRows(PodGVR))
	return rollups
}

func addNamespaceWorkloadObjectRollups(rollups *namespaceWorkloadRollups, ingest namespacePodIngestSource, gvr schema.GroupVersionResource) {
	for _, row := range ingest.CatalogRows(gvr) {
		if summary, ok := row.(objectcatalog.Summary); ok && summary.Ref.Namespace != "" {
			rollups.namespaces[summary.Ref.Namespace] = struct{}{}
		}
	}
	for _, row := range ingest.ObjectMapRows(gvr) {
		node, ok := row.(objectmapnode.Node)
		if !ok || node.Namespace == "" || node.Status == nil {
			continue
		}
		if isUnhealthyStatusPresentation(node.Status.Presentation) {
			rollups.unhealthy[node.Namespace]++
		}
	}
}

func addNamespacePodRollups(rollups *namespaceWorkloadRollups, rows []interface{}) {
	for _, row := range rows {
		agg, ok := row.(streamrows.PodAggregate)
		if !ok || agg.Namespace == "" {
			continue
		}
		rollups.namespaces[agg.Namespace] = struct{}{}
		active := agg.Phase != string(corev1.PodSucceeded) && agg.Phase != string(corev1.PodFailed)
		if active {
			addNamespaceReservations(rollups, agg)
		}
		if agg.OwnerKey == "" && active && isUnhealthyStatusPresentation(agg.StatusPresentation) {
			rollups.unhealthy[agg.Namespace]++
		}
	}
}

func addNamespaceReservations(rollups *namespaceWorkloadRollups, aggregate streamrows.PodAggregate) {
	reservations := rollups.reservations[aggregate.Namespace]
	reservations.cpuRequestsMilli += aggregate.CPURequestMilli
	reservations.cpuLimitsMilli += aggregate.CPULimitMilli
	reservations.memoryRequestsBytes += aggregate.MemRequestBytes
	reservations.memoryLimitsBytes += aggregate.MemLimitBytes
	rollups.reservations[aggregate.Namespace] = reservations
}

func parseResourceVersion(obj *corev1.Namespace) uint64 {
	if obj == nil {
		return 0
	}
	if rv := obj.ResourceVersion; rv != "" {
		if parsed, err := strconv.ParseUint(rv, 10, 64); err == nil {
			return parsed
		}
	}
	// Synthesized scoped rows carry neither RV nor creation time; a zero
	// timestamp must not wrap into a huge bogus version.
	if obj.CreationTimestamp.IsZero() {
		return 0
	}
	return uint64(obj.CreationTimestamp.UnixNano())
}
