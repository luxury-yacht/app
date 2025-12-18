package snapshot

import (
	"context"
	"sort"
	"strconv"

	appslisters "k8s.io/client-go/listers/apps/v1"
	batchlisters "k8s.io/client-go/listers/batch/v1"

	apimachineryerrors "k8s.io/apimachinery/pkg/api/errors"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/labels"
	informers "k8s.io/client-go/informers"
	corelisters "k8s.io/client-go/listers/core/v1"

	"github.com/luxury-yacht/app/backend/internal/parallel"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
)

// NamespaceBuilder constructs namespace snapshots from informer caches.
type NamespaceBuilder struct {
	namespaces   corelisters.NamespaceLister
	pods         corelisters.PodLister
	deployments  appslisters.DeploymentLister
	statefulsets appslisters.StatefulSetLister
	daemonsets   appslisters.DaemonSetLister
	jobs         batchlisters.JobLister
	cronJobs     batchlisters.CronJobLister
	tracker      *NamespaceWorkloadTracker
}

// NamespaceSnapshot payload returned to clients.
type NamespaceSnapshot struct {
	Namespaces []NamespaceSummary `json:"namespaces"`
}

// NamespaceSummary provides high level namespace metadata.
type NamespaceSummary struct {
	Name             string `json:"name"`
	Phase            string `json:"phase"`
	ResourceVersion  string `json:"resourceVersion"`
	CreationUnix     int64  `json:"creationTimestamp"`
	HasWorkloads     bool   `json:"hasWorkloads"`
	WorkloadsUnknown bool   `json:"workloadsUnknown,omitempty"`
}

// RegisterNamespaceDomain registers the namespace domain with the registry.
func RegisterNamespaceDomain(reg *domain.Registry, factory informers.SharedInformerFactory) error {
	tracker := NewNamespaceWorkloadTracker(factory)
	builder := &NamespaceBuilder{
		namespaces:   factory.Core().V1().Namespaces().Lister(),
		pods:         factory.Core().V1().Pods().Lister(),
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
	var (
		namespaces []*corev1.Namespace
		err        error
	)

	if scope != "" {
		var ns *corev1.Namespace
		ns, err = b.namespaces.Get(scope)
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
		items = append(items, NamespaceSummary{
			Name:             ns.Name,
			Phase:            string(ns.Status.Phase),
			ResourceVersion:  ns.ResourceVersion,
			CreationUnix:     ns.CreationTimestamp.Unix(),
			HasWorkloads:     hasWorkloads,
			WorkloadsUnknown: workloadsUnknown,
		})
		if v := parseResourceVersion(ns); v > version {
			version = v
		}
	}

	snap := &refresh.Snapshot{
		Domain:  "namespaces",
		Scope:   scope,
		Version: version,
		Payload: NamespaceSnapshot{Namespaces: items},
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

	if b.pods != nil {
		addTask(func() (int, error) {
			list, err := b.pods.Pods(namespace).List(selector)
			return len(list), err
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
