package snapshot

import (
	"context"
	"sort"
	"strconv"
	"strings"

	appslisters "k8s.io/client-go/listers/apps/v1"
	batchlisters "k8s.io/client-go/listers/batch/v1"

	apimachineryerrors "k8s.io/apimachinery/pkg/api/errors"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/labels"
	"k8s.io/apimachinery/pkg/runtime/schema"
	informers "k8s.io/client-go/informers"
	corelisters "k8s.io/client-go/listers/core/v1"

	"github.com/luxury-yacht/app/backend/internal/parallel"
	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	namespacepkg "github.com/luxury-yacht/app/backend/resources/namespaces"
)

// NamespaceBuilder constructs namespace snapshots from informer caches.
type NamespaceBuilder struct {
	namespaces   corelisters.NamespaceLister
	podIngest    namespacePodIngestSource
	deployments  appslisters.DeploymentLister
	statefulsets appslisters.StatefulSetLister
	daemonsets   appslisters.DaemonSetLister
	jobs         batchlisters.JobLister
	cronJobs     batchlisters.CronJobLister
	tracker      *NamespaceWorkloadTracker
}

// namespacePodIngestSource supplies the cut pod kind's projected rows the namespace
// domain reads: the tracker's incremental presence Sink + HasSynced gate, and the
// projected rows for the legacy per-namespace workload-detection pod count. It composes
// the tracker source so one value wires both. *ingest.IngestManager satisfies it.
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
		namespaces:   factory.Core().V1().Namespaces().Lister(),
		podIngest:    ingestManager,
		deployments:  factory.Apps().V1().Deployments().Lister(),
		statefulsets: factory.Apps().V1().StatefulSets().Lister(),
		daemonsets:   factory.Apps().V1().DaemonSets().Lister(),
		jobs:         factory.Batch().V1().Jobs().Lister(),
		cronJobs:     factory.Batch().V1().CronJobs().Lister(),
		tracker:      tracker,
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

	selector := labels.Everything()

	type checkResult struct {
		has bool
		err error
	}

	var tasks []func(context.Context) error
	var results []*checkResult

	addTask := func(run func() (int, error)) {
		res := &checkResult{}
		results = append(results, res)
		tasks = append(tasks, func(context.Context) error {
			count, err := run()
			if err != nil {
				if apimachineryerrors.IsNotFound(err) {
					return nil
				}
				res.err = err
				return err
			}
			if count > 0 {
				res.has = true
			}
			return nil
		})
	}

	if b.deployments != nil {
		addTask(func() (int, error) {
			list, err := b.deployments.Deployments(namespace).List(selector)
			return len(list), err
		})
	}

	if b.statefulsets != nil {
		addTask(func() (int, error) {
			list, err := b.statefulsets.StatefulSets(namespace).List(selector)
			return len(list), err
		})
	}

	if b.daemonsets != nil {
		addTask(func() (int, error) {
			list, err := b.daemonsets.DaemonSets(namespace).List(selector)
			return len(list), err
		})
	}

	if b.jobs != nil {
		addTask(func() (int, error) {
			list, err := b.jobs.Jobs(namespace).List(selector)
			return len(list), err
		})
	}

	if b.cronJobs != nil {
		addTask(func() (int, error) {
			list, err := b.cronJobs.CronJobs(namespace).List(selector)
			return len(list), err
		})
	}

	if b.podIngest != nil {
		addTask(func() (int, error) {
			// Pods is cut to ingest: count the namespace's projected PodAggregate rows
			// instead of listing the typed pod lister. Only the count matters here (the
			// legacy path's workload-presence signal), so reading the small aggregate
			// rows is sufficient and never touches a typed pod.
			count := 0
			for _, row := range b.podIngest.AggregateRows(PodGVR) {
				if agg, ok := row.(streamrows.PodAggregate); ok && agg.Namespace == namespace {
					count++
				}
			}
			return count, nil
		})
	}

	if len(tasks) == 0 {
		return false, nil
	}

	if err := parallel.RunLimited(context.Background(), 3, tasks...); err != nil {
		for _, res := range results {
			if res.err != nil {
				return false, res.err
			}
		}
		return false, err
	}

	for _, res := range results {
		if res.err != nil {
			return false, res.err
		}
		if res.has {
			return true, nil
		}
	}

	return false, nil
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
