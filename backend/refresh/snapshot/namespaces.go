package snapshot

import (
	"context"
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

	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/objectcatalog"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
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
func RegisterNamespaceDomain(reg *domain.Registry, factory informers.SharedInformerFactory, ingestManager namespacePodIngestSource) error {
	tracker := NewNamespaceWorkloadTracker(ingestManager)
	builder := &NamespaceBuilder{
		namespaces: factory.Core().V1().Namespaces().Lister(),
		ingest:     ingestManager,
		tracker:    tracker,
	}
	return reg.Register(refresh.DomainConfig{
		Name:          "namespaces",
		BuildSnapshot: builder.Build,
	})
}

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
	// Best-effort: wait for the cut workload + pod ingest stores to sync so the first build
	// already reflects real workload presence. The wait is bounded by ctx; positive rows are
	// usable immediately, but absence is authoritative only after the tracked stores settle.
	if b.tracker != nil {
		trackerReady = b.tracker.WaitForSync(ctx)
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
		Payload: NamespaceSnapshot{ClusterMeta: meta, Namespaces: items},
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
	set := make(map[string]struct{})
	if b.ingest == nil {
		return set
	}
	for _, gvr := range []schema.GroupVersionResource{
		DeploymentGVR, StatefulSetGVR, DaemonSetGVR, JobGVR, CronJobGVR,
	} {
		for _, row := range b.ingest.CatalogRows(gvr) {
			if summary, ok := row.(objectcatalog.Summary); ok && summary.Namespace != "" {
				set[summary.Namespace] = struct{}{}
			}
		}
	}
	for _, row := range b.ingest.AggregateRows(PodGVR) {
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
