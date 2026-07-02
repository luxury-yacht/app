package snapshot

import (
	"context"
	"fmt"
	"hash/fnv"
	"sort"
	"strconv"
	"strings"

	apimachineryerrors "k8s.io/apimachinery/pkg/api/errors"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/labels"
	"k8s.io/apimachinery/pkg/runtime/schema"
	informers "k8s.io/client-go/informers"
	corelisters "k8s.io/client-go/listers/core/v1"
	"k8s.io/client-go/tools/cache"

	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/objectcatalog"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	namespacepkg "github.com/luxury-yacht/app/backend/resources/namespaces"
)

// NamespaceBuilder constructs namespace snapshots from informer caches. Pods AND the five
// workload kinds are cut to the ingest path, so the legacy per-namespace workload-detection
// count reads each kind's projected rows from the ingest manager rather than a typed lister.
type NamespaceBuilder struct {
	namespaces corelisters.NamespaceLister
	ingest     namespacePodIngestSource
	tracker    *NamespaceWorkloadTracker
}

// namespacePodIngestSource is the ingest surface the namespace domain reads: the per-kind sync
// gate (Tracks/HasSyncedFor, used by NewNamespaceWorkloadTracker) plus the projected rows the
// per-build workload-presence set is computed from (the cut workload kinds' Catalog rows and the
// pod kind's Aggregate rows).
type namespacePodIngestSource interface {
	Tracks(gvr schema.GroupVersionResource) bool
	HasSyncedFor(gvr schema.GroupVersionResource) bool
	CatalogRows(gvr schema.GroupVersionResource) []interface{}
	AggregateRows(gvr schema.GroupVersionResource) []interface{}
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
	Ref                resourcemodel.ResourceRef `json:"ref"`
	Name               string                    `json:"name"`
	Phase              string                    `json:"phase"`
	Status             string                    `json:"status,omitempty"`
	StatusState        string                    `json:"statusState,omitempty"`
	StatusPresentation string                    `json:"statusPresentation,omitempty"`
	StatusReason       string                    `json:"statusReason,omitempty"`
	ResourceVersion    string                    `json:"resourceVersion"`
	CreationUnix       int64                     `json:"creationTimestamp"`
	HasWorkloads       bool                      `json:"hasWorkloads"`
	WorkloadsUnknown   bool                      `json:"workloadsUnknown,omitempty"`
}

// RegisterNamespaceDomain registers the namespace domain with the registry. The cut workload +
// pod kinds' projected rows come from the ingest manager (read per build for workload presence);
// the tracker only gates the read on those stores having synced. ingestManager may be nil in a
// unit test.
//
// It returns the change notifier that replaces the frontend's namespaces poll: namespace
// informer events and workload/pod ingest events feed it (handlers/sinks registered HERE,
// before the informer factory and ingest manager start), and the subsystem wires its
// broadcast to the resource-stream doorbell once the stream manager exists.
func RegisterNamespaceDomain(reg *domain.Registry, factory informers.SharedInformerFactory, ingestManager namespacePodIngestSource) (*NamespaceChangeNotifier, error) {
	tracker := NewNamespaceWorkloadTracker(ingestManager)
	builder := &NamespaceBuilder{
		namespaces: factory.Core().V1().Namespaces().Lister(),
		ingest:     ingestManager,
		tracker:    tracker,
	}
	notifier := NewNamespaceChangeNotifier(ingestManager, tracker)
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
	}
	if err := reg.Register(refresh.DomainConfig{
		Name:          "namespaces",
		BuildSnapshot: builder.Build,
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

// Build returns the namespace snapshot payload.
func (b *NamespaceBuilder) Build(ctx context.Context, scope string) (*refresh.Snapshot, error) {
	meta := ClusterMetaFromContext(ctx)
	_, scopeValue := refresh.SplitClusterScope(scope)
	var (
		namespaces []*corev1.Namespace
		err        error
	)

	if strings.TrimSpace(scopeValue) != "" {
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
	} else {
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
	workloadNamespaces := b.namespacesWithWorkloads()

	items := make([]NamespaceSummary, 0, len(namespaces))
	var version uint64
	for _, ns := range namespaces {
		_, hasWorkloads := workloadNamespaces[ns.Name]
		workloadsKnown := hasWorkloads || trackerReady
		model := namespacepkg.BuildResourceModel(meta.ClusterID, ns, hasWorkloads, workloadsKnown, nil, nil)
		facts := namespacepkg.BuildFacts(meta.ClusterID, ns, hasWorkloads, workloadsKnown, nil, nil, resourcemodel.ResourceModelBuildOptions{})
		items = append(items, NamespaceSummary{
			ClusterMeta:        meta,
			Ref:                model.Ref,
			Name:               model.Ref.Name,
			Phase:              model.Status.State,
			Status:             model.Status.Label,
			StatusState:        model.Status.State,
			StatusPresentation: model.Status.Presentation,
			StatusReason:       model.Status.Reason,
			ResourceVersion:    model.Metadata.ResourceVersion,
			CreationUnix:       model.Metadata.CreationTimestamp.Unix(),
			HasWorkloads:       facts.HasWorkloads,
			WorkloadsUnknown:   !facts.WorkloadsKnown,
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
			"workloads": workloadPresenceSignature(workloadNamespaces, trackerReady),
		},
	}
	return snap, nil
}

// workloadPresenceSignature is a stable fingerprint of the set of namespaces that have at least
// one workload and whether empty absence is authoritative yet. It changes when that set or the
// sync-readiness state changes, so a workload-presence or unknown→known change yields a new
// snapshot validator and is delivered to the client instead of being 304'd.
func workloadPresenceSignature(set map[string]struct{}, ready bool) string {
	names := make([]string, 0, len(set))
	for ns := range set {
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
		_, _ = h.Write([]byte{0})
	}
	return strconv.FormatUint(h.Sum64(), 16)
}

// namespacesWithWorkloads returns the set of namespaces that have at least one workload, read
// directly from the ingest stores in a single pass: the five cut workload kinds' projected
// Catalog rows (Deployment/StatefulSet/DaemonSet/Job/CronJob) plus the pod aggregate rows. It
// is the authoritative, drift-free source the per-namespace workload flag is derived from —
// the same projected rows Browse reads (objectcatalog collectViaIngest), so a namespace whose
// workloads are ingested is never wrongly reported as empty.
func (b *NamespaceBuilder) namespacesWithWorkloads() map[string]struct{} {
	return namespacesWithWorkloadsFromIngest(b.ingest)
}

// namespacesWithWorkloadsFromIngest is the shared presence computation: the
// builder derives per-namespace flags from it, and the change notifier hashes
// it to decide whether an ingest event actually flipped presence.
func namespacesWithWorkloadsFromIngest(ingest namespacePodIngestSource) map[string]struct{} {
	set := make(map[string]struct{})
	if ingest == nil {
		return set
	}
	for _, gvr := range []schema.GroupVersionResource{
		DeploymentGVR, StatefulSetGVR, DaemonSetGVR, JobGVR, CronJobGVR,
	} {
		for _, row := range ingest.CatalogRows(gvr) {
			if summary, ok := row.(objectcatalog.Summary); ok && summary.Namespace != "" {
				set[summary.Namespace] = struct{}{}
			}
		}
	}
	for _, row := range ingest.AggregateRows(PodGVR) {
		if agg, ok := row.(streamrows.PodAggregate); ok && agg.Namespace != "" {
			set[agg.Namespace] = struct{}{}
		}
	}
	return set
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
	return uint64(obj.CreationTimestamp.UnixNano())
}
