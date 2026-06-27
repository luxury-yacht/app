package snapshot

import (
	"context"
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

// namespacePodIngestSource supplies the cut pod + workload kinds' projected rows the
// namespace domain reads: the tracker's incremental presence Sink + HasSynced gate, the
// projected pod aggregate rows for the legacy workload-detection pod count, and the
// projected workload catalog rows for the workload-detection counts. It composes the
// tracker source so one value wires both. *ingest.IngestManager satisfies it.
type namespacePodIngestSource interface {
	trackerPodIngestSource
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

// RegisterNamespaceDomain registers the namespace domain with the registry. Pods is cut
// to the ingest path, so both the workload tracker's pod presence and the legacy
// per-namespace workload-detection pod count read the pod kind's projected rows from the
// ingest manager rather than a typed pod lister. ingestManager may be nil in a unit test.
func RegisterNamespaceDomain(reg *domain.Registry, factory informers.SharedInformerFactory, ingestManager namespacePodIngestSource) error {
	tracker := NewNamespaceWorkloadTracker(factory, ingestManager)
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

	trackerReady := false
	if b.tracker != nil {
		trackerReady = b.tracker.WaitForSync(ctx)
	}

	items := make([]NamespaceSummary, 0, len(namespaces))
	var version uint64
	for _, ns := range namespaces {
		hasWorkloads, workloadsUnknown := b.namespaceWorkloadsStatus(ns.Name, trackerReady)
		model := namespacepkg.BuildResourceModel(meta.ClusterID, ns, hasWorkloads, !workloadsUnknown, nil, nil)
		facts := namespacepkg.BuildFacts(meta.ClusterID, ns, hasWorkloads, !workloadsUnknown, nil, nil, resourcemodel.ResourceModelBuildOptions{})
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
	}
	return snap, nil
}

func (b *NamespaceBuilder) namespaceWorkloadsStatus(namespace string, trackerReady bool) (bool, bool) {
	if namespace == "" {
		return false, false
	}

	if trackerReady && b.tracker != nil {
		if has, known := b.tracker.HasWorkloads(namespace); known {
			return has, false
		}
		legacy, err := b.namespaceHasWorkloadsLegacy(namespace)
		if err != nil {
			b.tracker.MarkUnknown(namespace)
			return false, true
		}
		b.tracker.MarkUnknown(namespace)
		return legacy, true
	}

	legacy, err := b.namespaceHasWorkloadsLegacy(namespace)
	if err != nil {
		if b.tracker != nil {
			b.tracker.MarkUnknown(namespace)
		}
		return false, true
	}
	return legacy, false
}

func (b *NamespaceBuilder) namespaceHasWorkloadsLegacy(namespace string) (bool, error) {
	if namespace == "" {
		return false, nil
	}
	if b.ingest == nil {
		return false, nil
	}

	// Pods and the five workload kinds are cut to ingest: detect workload presence by
	// counting the namespace's projected rows in each kind's ingest store rather than
	// listing typed listers. Only presence (a non-empty count) matters for the legacy
	// signal, so the small projected rows are sufficient and never touch a typed object.
	if catalogRowsInNamespace(b.ingest, DeploymentGVR, namespace) > 0 ||
		catalogRowsInNamespace(b.ingest, StatefulSetGVR, namespace) > 0 ||
		catalogRowsInNamespace(b.ingest, DaemonSetGVR, namespace) > 0 ||
		catalogRowsInNamespace(b.ingest, JobGVR, namespace) > 0 ||
		catalogRowsInNamespace(b.ingest, CronJobGVR, namespace) > 0 {
		return true, nil
	}
	for _, row := range b.ingest.AggregateRows(PodGVR) {
		if agg, ok := row.(streamrows.PodAggregate); ok && agg.Namespace == namespace {
			return true, nil
		}
	}
	return false, nil
}

// catalogRowsInNamespace counts the projected catalog rows for gvr whose Summary belongs to
// the namespace — the ingest replacement for a typed lister's per-namespace List length.
func catalogRowsInNamespace(source namespacePodIngestSource, gvr schema.GroupVersionResource, namespace string) int {
	count := 0
	for _, row := range source.CatalogRows(gvr) {
		if summary, ok := row.(objectcatalog.Summary); ok && summary.Namespace == namespace {
			count++
		}
	}
	return count
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
