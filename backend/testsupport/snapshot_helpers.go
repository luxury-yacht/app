package testsupport

import (
	"testing"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/tools/cache"

	appslisters "k8s.io/client-go/listers/apps/v1"
	corelisters "k8s.io/client-go/listers/core/v1"
)

// buildIndexer populates an in-memory indexer with the supplied objects, shared
// by the indexer and lister test helpers.
func buildIndexer[T any](t testing.TB, indexers cache.Indexers, objs []*T) cache.Indexer {
	t.Helper()
	indexer := cache.NewIndexer(cache.MetaNamespaceKeyFunc, indexers)
	for _, obj := range objs {
		if obj == nil {
			continue
		}
		if err := indexer.Add(obj); err != nil {
			t.Fatalf("failed to add object to indexer: %v", err)
		}
	}
	return indexer
}

func newNamespacedIndexer[T any](t testing.TB, objs []*T) cache.Indexer {
	return buildIndexer(t, cache.Indexers{cache.NamespaceIndex: cache.MetaNamespaceIndexFunc}, objs)
}

func newClusterIndexer[T any](t testing.TB, objs []*T) cache.Indexer {
	return buildIndexer(t, cache.Indexers{}, objs)
}

// NewNamespacedIndexer builds a namespace-indexed cache.Indexer holding the given
// objects. Tests use it to feed descriptor-driven typed-table snapshot builders
// without standing up an ingest manager.
func NewNamespacedIndexer[T any](t testing.TB, objs ...*T) cache.Indexer {
	return newNamespacedIndexer(t, objs)
}

// NewClusterIndexer builds a cluster-scoped cache.Indexer holding the given objects.
func NewClusterIndexer[T any](t testing.TB, objs ...*T) cache.Indexer {
	return newClusterIndexer(t, objs)
}

// NewPodLister constructs a pod lister backed by an in-memory indexer populated
// with the supplied pod objects.
func NewPodLister(t testing.TB, pods ...*corev1.Pod) corelisters.PodLister {
	return corelisters.NewPodLister(newNamespacedIndexer(t, pods))
}

// NewReplicaSetLister constructs a ReplicaSet lister backed by an in-memory
// indexer populated with the supplied ReplicaSet objects.
func NewReplicaSetLister(t testing.TB, replicaSets ...*appsv1.ReplicaSet) appslisters.ReplicaSetLister {
	return appslisters.NewReplicaSetLister(newNamespacedIndexer(t, replicaSets))
}

// ReplicaSetOwnerLookup adapts a ReplicaSet lister to the owner lookup pod
// projection takes: the ReplicaSet's controlling owner reference, and whether
// the ReplicaSet exists. A nil lister yields a nil lookup (no source).
func ReplicaSetOwnerLookup(lister appslisters.ReplicaSetLister) func(namespace, name string) (metav1.OwnerReference, bool) {
	if lister == nil {
		return nil
	}
	return func(namespace, name string) (metav1.OwnerReference, bool) {
		rs, err := lister.ReplicaSets(namespace).Get(name)
		if err != nil {
			return metav1.OwnerReference{}, false
		}
		if controller := metav1.GetControllerOfNoCopy(rs); controller != nil {
			return *controller, true
		}
		return metav1.OwnerReference{}, true
	}
}
