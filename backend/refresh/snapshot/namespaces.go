package snapshot

import (
	"context"
	"fmt"
	"hash/fnv"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	apimachineryerrors "k8s.io/apimachinery/pkg/api/errors"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/labels"
	"k8s.io/apimachinery/pkg/runtime/schema"
	informers "k8s.io/client-go/informers"
	"k8s.io/client-go/kubernetes"
	corelisters "k8s.io/client-go/listers/core/v1"
	"k8s.io/client-go/tools/cache"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/kind/objectmapnode"
	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/objectcatalog"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	namespacepkg "github.com/luxury-yacht/app/backend/resources/namespaces"
	resourcequotapkg "github.com/luxury-yacht/app/backend/resources/resourcequota"
)

var ResourceQuotaGVR = schema.GroupVersionResource{Group: resourcequotapkg.Identity.Group, Version: resourcequotapkg.Identity.Version, Resource: resourcequotapkg.Identity.Resource}

// NamespaceBuilder constructs namespace snapshots from informer caches. Pods AND the five
// workload kinds are cut to the ingest path, so the legacy per-namespace workload-detection
// count reads each kind's projected rows from the ingest manager rather than a typed lister.
type NamespaceBuilder struct {
	namespaces  corelisters.NamespaceLister
	eventLister corelisters.EventLister
	// eventsExpected is true only when the identity may list and watch the
	// cluster-wide Events informer. A denied source is unavailable, while an
	// allowed source that has not synced yet is loading.
	eventsExpected bool
	eventsSynced   cache.InformerSynced
	ingest         namespacePodIngestSource
	tracker        *NamespaceWorkloadTracker
	// scope is the cluster's configured namespace scope
	// (docs/plans/namespace-scope.md). Non-empty means the rows are
	// synthesized from these names instead of read from the (cluster-wide,
	// permission-gated) namespace lister; empty means today's lister path.
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

// namespacePodIngestSource is the ingest surface the namespace domain reads: the per-kind sync
// gate (Tracks/HasSyncedFor, used by NewNamespaceWorkloadTracker) plus the projected rows the
// per-build workload-presence set is computed from (the cut workload kinds' Catalog rows and the
// pod and ResourceQuota kinds' Aggregate rows).
type namespacePodIngestSource interface {
	Tracks(gvr schema.GroupVersionResource) bool
	HasSyncedFor(gvr schema.GroupVersionResource) bool
	CatalogRows(gvr schema.GroupVersionResource) []interface{}
	AggregateRows(gvr schema.GroupVersionResource) []interface{}
	ObjectMapRows(gvr schema.GroupVersionResource) []interface{}
}

// NamespaceSnapshot payload returned to clients.
type NamespaceSnapshot struct {
	ClusterMeta
	Namespaces []NamespaceSummary `json:"namespaces"`
	// WorkloadsReady reports whether the pod + workload ingest stores this snapshot's
	// workload-presence flags derive from have SETTLED (synced/degraded/permission-skipped).
	// It is a backend-internal readiness signal — the cluster lifecycle gate flips a cluster
	// to Ready only on a namespace snapshot with this true, so "Ready" means data has loaded
	// rather than merely "the namespace list served" (which is immediate). Not serialized: the
	// frontend derives per-namespace state from workloadsUnknown, not this whole-snapshot flag.
	WorkloadsReady bool `json:"-"`
}

// NamespaceSummary provides high level namespace metadata.
type NamespaceSummary struct {
	ClusterMeta
	Ref                        resourcemodel.ResourceRef `json:"ref"`
	Name                       string                    `json:"name"`
	Phase                      string                    `json:"phase"`
	Status                     string                    `json:"status,omitempty"`
	StatusState                string                    `json:"statusState,omitempty"`
	StatusPresentation         string                    `json:"statusPresentation,omitempty"`
	StatusReason               string                    `json:"statusReason,omitempty"`
	ResourceVersion            string                    `json:"resourceVersion"`
	CreationUnix               int64                     `json:"creationTimestamp"`
	HasWorkloads               bool                      `json:"hasWorkloads"`
	WorkloadsUnknown           bool                      `json:"workloadsUnknown,omitempty"`
	UnhealthyWorkloads         int                       `json:"unhealthyWorkloads,omitempty"`
	WarningEvents              int                       `json:"warningEvents,omitempty"`
	WarningEventsState         NamespaceSignalState      `json:"warningEventsState"`
	CPURequestsMilli           int64                     `json:"cpuRequestsMilli,omitempty"`
	CPULimitsMilli             int64                     `json:"cpuLimitsMilli,omitempty"`
	MemoryRequestsBytes        int64                     `json:"memoryRequestsBytes,omitempty"`
	MemoryLimitsBytes          int64                     `json:"memoryLimitsBytes,omitempty"`
	QuotaCount                 int                       `json:"quotaCount,omitempty"`
	QuotaHighestUsedPercentage int                       `json:"quotaHighestUsedPercentage,omitempty"`
	QuotaPressure              NamespaceQuotaPressure    `json:"quotaPressure,omitempty"`
	QuotaPressureState         NamespaceSignalState      `json:"quotaPressureState"`
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

// RegisterNamespaceDomain registers the namespace domain with the registry. The cut workload +
// pod kinds' projected rows come from the ingest manager (read per build for workload presence);
// the tracker only gates the read on those stores having synced. ingestManager may be nil in a
// unit test.
//
// It returns the change notifier that replaces the frontend's namespaces poll: namespace
// informer events and workload/pod ingest events feed it (handlers/sinks registered HERE,
// before the informer factory and ingest manager start), and the subsystem wires its
// broadcast to the resource-stream doorbell once the stream manager exists.
func RegisterNamespaceDomain(reg *domain.Registry, factory informers.SharedInformerFactory, ingestManager namespacePodIngestSource, allowedNamespaces []string, client kubernetes.Interface, eventsExpected bool) (*NamespaceChangeNotifier, error) {
	tracker := NewNamespaceWorkloadTracker(ingestManager)
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
	notifier := NewNamespaceChangeNotifier(ingestManager, tracker)
	if eventsExpected && factory != nil {
		eventInformer := factory.Core().V1().Events()
		builder.eventLister = eventInformer.Lister()
		builder.eventsExpected = true
		builder.eventsSynced = eventInformer.Informer().HasSynced
		notifier.eventLister = builder.eventLister
		notifier.eventsExpected = true
		notifier.eventsSynced = builder.eventsSynced
		if _, err := eventInformer.Informer().AddEventHandler(cache.ResourceEventHandlerFuncs{
			AddFunc:    func(interface{}) { notifier.EventChanged() },
			UpdateFunc: func(interface{}, interface{}) { notifier.EventChanged() },
			DeleteFunc: func(interface{}) { notifier.EventChanged() },
		}); err != nil {
			return nil, fmt.Errorf("namespaces: register event aggregate handler: %w", err)
		}
	}
	// Scoped clusters synthesize rows from the configured names: the
	// (cluster-scoped, typically denied) namespaces informer is never
	// instantiated, and namespace add/delete events cannot occur — the row
	// set only changes through a settings-triggered subsystem rebuild.
	if len(builder.scope) == 0 {
		builder.namespaces = factory.Core().V1().Namespaces().Lister()
		if _, err := factory.Core().V1().Namespaces().Informer().AddEventHandler(cache.ResourceEventHandlerFuncs{
			AddFunc: func(interface{}) { notifier.NamespaceChanged() },
			UpdateFunc: func(oldObj, newObj interface{}) {
				// Informer resyncs re-deliver every namespace with an unchanged
				// ResourceVersion; only real updates ring the doorbell.
				if namespaceUpdateIsEcho(oldObj, newObj) {
					return
				}
				notifier.NamespaceChanged()
			},
			DeleteFunc: func(interface{}) { notifier.NamespaceChanged() },
		}); err != nil {
			return nil, fmt.Errorf("namespaces: register namespace handler: %w", err)
		}
	}
	// Bundle sinks fire on every Upsert/Delete/Replace for their GVR, which is all
	// the notifier needs: the flush decides via the presence signature whether the
	// event actually flipped a namespace's workload presence. AddBundleSink returns
	// false for an untracked GVR (permission-skipped) — those kinds then simply
	// never contribute events, matching the builder's per-build read.
	if sinks, ok := ingestManager.(interface {
		AddBundleSink(gvr schema.GroupVersionResource, sink ingest.BundleSink) bool
	}); ok {
		for _, gvr := range []schema.GroupVersionResource{
			DeploymentGVR, StatefulSetGVR, DaemonSetGVR, JobGVR, CronJobGVR, PodGVR,
		} {
			sinks.AddBundleSink(gvr, namespaceNotifierSink{notifier: notifier})
		}
		sinks.AddBundleSink(ResourceQuotaGVR, namespaceQuotaNotifierSink{notifier: notifier})
	}
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

// namespaceUpdateIsEcho reports whether an informer Update delivery is a resync
// echo (unchanged ResourceVersion) rather than a real object change. Unrecognized
// objects are treated as real updates — suppression must never lose a signal.
func namespaceUpdateIsEcho(oldObj, newObj interface{}) bool {
	oldNs, okOld := oldObj.(*corev1.Namespace)
	newNs, okNew := newObj.(*corev1.Namespace)
	if !okOld || !okNew {
		return false
	}
	return oldNs.ResourceVersion != "" && oldNs.ResourceVersion == newNs.ResourceVersion
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

// Build returns the namespace snapshot payload.
func (b *NamespaceBuilder) Build(ctx context.Context, scope string) (*refresh.Snapshot, error) {
	meta := ClusterMetaFromContext(ctx)
	_, scopeValue := refresh.SplitClusterScope(scope)
	var (
		namespaces []*corev1.Namespace
		err        error
	)

	scopeStatuses := make(map[string]NamespaceScopeStatus)
	switch {
	case len(b.scope) > 0:
		// Scoped cluster: rows come from the configured scope. A
		// per-namespace GET probe enriches each row from the real object
		// where permitted and flags names the identity cannot reach
		// (not-found / no-access); without a probe result the row stays
		// name-only.
		for _, name := range b.scope {
			if strings.TrimSpace(scopeValue) != "" && name != scopeValue {
				continue
			}
			probed, status := b.probeScopedNamespace(ctx, name)
			scopeStatuses[name] = status
			if probed != nil {
				namespaces = append(namespaces, probed)
				continue
			}
			namespaces = append(namespaces, &corev1.Namespace{
				ObjectMeta: metav1.ObjectMeta{Name: name},
			})
		}
	case strings.TrimSpace(scopeValue) != "":
		var ns *corev1.Namespace
		ns, err = b.namespaces.Get(scopeValue)
		if err != nil {
			if apimachineryerrors.IsNotFound(err) {
				namespaces = []*corev1.Namespace{}
				err = nil
			} else {
				return nil, err
			}
		} else {
			namespaces = []*corev1.Namespace{ns}
		}
	default:
		namespaces, err = b.namespaces.List(labels.Everything())
		if err != nil {
			return nil, err
		}
	}

	if len(namespaces) > 1 {
		sort.Slice(namespaces, func(i, j int) bool {
			return namespaces[i].Name < namespaces[j].Name
		})
	}

	trackerReady := true
	// Non-blocking: read whether the cut workload + pod ingest stores have synced rather than
	// waiting on them. The namespace list must paint without blocking on the pod/workload initial
	// LIST. Positive workload rows are usable immediately; a namespace's absence of workloads is
	// authoritative only once the tracked stores settle, so before then it is reported as
	// not-yet-known and the workload-presence source clock re-delivers the corrected snapshot.
	if b.tracker != nil {
		trackerReady = b.tracker.Synced()
	}
	workloadRollups := namespaceWorkloadRollupsFromIngest(b.ingest)
	workloadNamespaces := workloadRollups.namespaces
	warningEvents, warningEventsState := b.warningEventRollups()
	quotaRollups, quotaState := namespaceQuotaRollupsFromIngest(b.ingest)

	items := make([]NamespaceSummary, 0, len(namespaces))
	var version uint64
	for _, ns := range namespaces {
		_, hasWorkloads := workloadNamespaces[ns.Name]
		reservations := workloadRollups.reservations[ns.Name]
		quota := quotaRollups[ns.Name]
		// In scoped mode a tracker that latched synced because NOTHING is
		// tracked (every workload kind permission-skipped) means presence is
		// genuinely unknown — reporting it as authoritative would dim every
		// configured namespace. Unscoped behavior is unchanged.
		workloadsKnown := hasWorkloads || (trackerReady && (len(b.scope) == 0 || b.tracksAnyWorkloadKind()))
		model := namespacepkg.BuildResourceModel(meta.ClusterID, ns, hasWorkloads, workloadsKnown, nil, nil)
		facts := namespacepkg.BuildFacts(meta.ClusterID, ns, hasWorkloads, workloadsKnown, nil, nil, resourcemodel.ResourceModelBuildOptions{})
		items = append(items, NamespaceSummary{
			ClusterMeta:                meta,
			Ref:                        model.Ref,
			Name:                       model.Ref.Name,
			Phase:                      model.Status.State,
			Status:                     model.Status.Label,
			StatusState:                model.Status.State,
			StatusPresentation:         model.Status.Presentation,
			StatusReason:               model.Status.Reason,
			ResourceVersion:            model.Metadata.ResourceVersion,
			CreationUnix:               model.Metadata.CreationTimestamp.Unix(),
			HasWorkloads:               facts.HasWorkloads,
			WorkloadsUnknown:           !facts.WorkloadsKnown,
			UnhealthyWorkloads:         workloadRollups.unhealthy[ns.Name],
			WarningEvents:              warningEvents[ns.Name],
			WarningEventsState:         warningEventsState,
			CPURequestsMilli:           reservations.cpuRequestsMilli,
			CPULimitsMilli:             reservations.cpuLimitsMilli,
			MemoryRequestsBytes:        reservations.memoryRequestsBytes,
			MemoryLimitsBytes:          reservations.memoryLimitsBytes,
			QuotaCount:                 quota.count,
			QuotaHighestUsedPercentage: quota.highestUsedPercentage,
			QuotaPressure:              namespaceQuotaPressure(quota.highestUsedPercentage),
			QuotaPressureState:         quotaState,
			ScopeStatus:                scopeStatuses[ns.Name],
		})
		if v := parseResourceVersion(ns); v > version {
			version = v
		}
	}

	snap := &refresh.Snapshot{
		Domain:  "namespaces",
		Scope:   scope,
		Version: version,
		Payload: NamespaceSnapshot{ClusterMeta: meta, Namespaces: items, WorkloadsReady: trackerReady},
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
			"workloads":      workloadRollupSignature(workloadRollups, trackerReady),
			"warning-events": warningEventRollupSignature(warningEvents, warningEventsState),
			"quota-pressure": namespaceQuotaRollupSignature(quotaRollups, quotaState),
		},
	}
	if len(b.scope) > 0 {
		// Probe flags are content the namespace RV clock cannot carry (a
		// flagged row has no RV at all) — publish them as their own source
		// clock so transitions are delivered instead of 304'd.
		snap.SourceVersions["scope-probe"] = scopeProbeSignature(scopeStatuses)
	}
	return snap, nil
}

func (b *NamespaceBuilder) warningEventRollups() (map[string]int, NamespaceSignalState) {
	return namespaceWarningEventRollups(b.eventLister, b.eventsExpected, b.eventsSynced)
}

func namespaceWarningEventRollups(eventLister corelisters.EventLister, eventsExpected bool, eventsSynced cache.InformerSynced) (map[string]int, NamespaceSignalState) {
	counts := make(map[string]int)
	if !eventsExpected || eventLister == nil {
		return counts, NamespaceSignalUnavailable
	}
	if eventsSynced == nil || !eventsSynced() {
		return counts, NamespaceSignalLoading
	}
	events, err := eventLister.List(labels.Everything())
	if err != nil {
		return counts, NamespaceSignalUnavailable
	}
	for _, event := range events {
		if event == nil || !strings.EqualFold(event.Type, corev1.EventTypeWarning) {
			continue
		}
		namespace := strings.TrimSpace(event.InvolvedObject.Namespace)
		if namespace == "" {
			continue
		}
		counts[namespace]++
	}
	return counts, NamespaceSignalAvailable
}

func warningEventRollupSignature(counts map[string]int, state NamespaceSignalState) string {
	names := make([]string, 0, len(counts))
	for namespace := range counts {
		names = append(names, namespace)
	}
	sort.Strings(names)
	h := fnv.New64a()
	_, _ = h.Write([]byte(state))
	_, _ = h.Write([]byte{0})
	for _, namespace := range names {
		_, _ = h.Write([]byte(namespace))
		_, _ = h.Write([]byte{'='})
		_, _ = h.Write([]byte(strconv.Itoa(counts[namespace])))
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
	if source == nil || !source.Tracks(ResourceQuotaGVR) {
		return rollups, NamespaceSignalUnavailable
	}
	if stateSource, ok := source.(namespaceQuotaIngestState); ok {
		if stateSource.PermissionSkippedFor(ResourceQuotaGVR) {
			return rollups, NamespaceSignalUnavailable
		}
		if !stateSource.RawHasSyncedFor(ResourceQuotaGVR) {
			if source.HasSyncedFor(ResourceQuotaGVR) {
				return rollups, NamespaceSignalUnavailable
			}
			return rollups, NamespaceSignalLoading
		}
	} else if !source.HasSyncedFor(ResourceQuotaGVR) {
		return rollups, NamespaceSignalLoading
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
func workloadRollupSignature(rollups namespaceWorkloadRollups, ready bool) string {
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
	if ready {
		_, _ = h.Write([]byte("ready"))
	} else {
		_, _ = h.Write([]byte("not-ready"))
	}
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
	for _, gvr := range []schema.GroupVersionResource{
		DeploymentGVR, StatefulSetGVR, DaemonSetGVR, JobGVR, CronJobGVR, PodGVR,
	} {
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
		for _, row := range ingest.CatalogRows(gvr) {
			if summary, ok := row.(objectcatalog.Summary); ok && summary.Namespace != "" {
				rollups.namespaces[summary.Namespace] = struct{}{}
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
	for _, row := range ingest.AggregateRows(PodGVR) {
		if agg, ok := row.(streamrows.PodAggregate); ok && agg.Namespace != "" {
			rollups.namespaces[agg.Namespace] = struct{}{}
			active := agg.Phase != string(corev1.PodSucceeded) && agg.Phase != string(corev1.PodFailed)
			if active {
				reservations := rollups.reservations[agg.Namespace]
				reservations.cpuRequestsMilli += agg.CPURequestMilli
				reservations.cpuLimitsMilli += agg.CPULimitMilli
				reservations.memoryRequestsBytes += agg.MemRequestBytes
				reservations.memoryLimitsBytes += agg.MemLimitBytes
				rollups.reservations[agg.Namespace] = reservations
			}
			if agg.OwnerKey == "" && active && isUnhealthyStatusPresentation(agg.StatusPresentation) {
				rollups.unhealthy[agg.Namespace]++
			}
		}
	}
	return rollups
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
