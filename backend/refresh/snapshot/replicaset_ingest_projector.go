// ReplicaSet intake projects catalog metadata, the graph node, and the
// controlling owner that Pod projection resolves Deployment ownership through.
package snapshot

import (
	"sync"

	appsv1 "k8s.io/api/apps/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"

	"github.com/luxury-yacht/app/backend/kind/objectmapnode"
	"github.com/luxury-yacht/app/backend/objectcatalog"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
	"github.com/luxury-yacht/app/backend/resources/replicaset"
)

// ReplicaSetGVR / ReplicaSetGVK key the owned ReplicaSet reflector.
var (
	ReplicaSetGVR = schema.GroupVersionResource{Group: replicaset.Identity.Group, Version: replicaset.Identity.Version, Resource: replicaset.Identity.Resource}
	ReplicaSetGVK = schema.GroupVersionKind{Group: replicaset.Identity.Group, Version: replicaset.Identity.Version, Kind: replicaset.Identity.Kind}
)

// ReplicaSetOwner is a ReplicaSet's controlling owner reference, retained as
// the bundle's aggregate half. Controller is zero when nothing controls it.
type ReplicaSetOwner struct {
	Namespace  string
	Name       string
	Controller metav1.OwnerReference
}

// NewReplicaSetIngestProjector returns the ProjectFunc for the owned ReplicaSet
// reflector. ReplicaSets have no table, so the bundle carries no Table half.
func NewReplicaSetIngestProjector(meta ClusterMeta) ingest.ProjectFunc {
	catalogProject := objectcatalog.SummaryProjector(meta.ClusterID, replicaset.Identity)
	nodeProject := objectmapnode.NewNodeProjector(replicaset.ObjectMapNode.Status, replicaset.ObjectMapNode.ActionFacts, replicaset.ObjectMapEdges)
	return func(obj interface{}) (interface{}, error) {
		rs, ok := obj.(*appsv1.ReplicaSet)
		if !ok {
			return nil, workloadProjectionError("ingest: replicaset projector received a non-ReplicaSet object")
		}
		var metaObj metav1.Object = rs
		return ingest.Bundle{
			Aggregate: projectReplicaSetOwner(rs),
			Catalog:   catalogProject(metaObj),
			ObjectMap: nodeProject(meta.ClusterID, metaObj),
		}, nil
	}
}

func projectReplicaSetOwner(rs *appsv1.ReplicaSet) ReplicaSetOwner {
	owner := ReplicaSetOwner{Namespace: rs.Namespace, Name: rs.Name}
	if controller := metav1.GetControllerOfNoCopy(rs); controller != nil {
		owner.Controller = *controller
	}
	return owner
}

// ReplicaSetOwnerIndex is a concurrency-safe lookup of each ReplicaSet's
// controlling owner, fed from ReplicaSet bundle delivery. Pod projection reads
// it instead of the ReplicaSet store, which it must not read while the Pod
// store is locked.
type ReplicaSetOwnerIndex struct {
	mu     sync.RWMutex
	owners map[string]metav1.OwnerReference
}

func NewReplicaSetOwnerIndex() *ReplicaSetOwnerIndex {
	return &ReplicaSetOwnerIndex{owners: make(map[string]metav1.OwnerReference)}
}

func replicaSetOwnerKey(namespace, name string) string {
	return namespace + "\x00" + name
}

// Lookup returns the ReplicaSet's controlling owner and whether it is known.
func (i *ReplicaSetOwnerIndex) Lookup(namespace, name string) (metav1.OwnerReference, bool) {
	if i == nil {
		return metav1.OwnerReference{}, false
	}
	i.mu.RLock()
	owner, ok := i.owners[replicaSetOwnerKey(namespace, name)]
	i.mu.RUnlock()
	return owner, ok
}

func (i *ReplicaSetOwnerIndex) UpsertBundle(bundle ingest.Bundle) {
	owner, ok := bundle.Aggregate.(ReplicaSetOwner)
	if i == nil || !ok || owner.Name == "" {
		return
	}
	i.mu.Lock()
	i.owners[replicaSetOwnerKey(owner.Namespace, owner.Name)] = owner.Controller
	i.mu.Unlock()
}

func (i *ReplicaSetOwnerIndex) DeleteBundle(bundle ingest.Bundle) {
	owner, ok := bundle.Aggregate.(ReplicaSetOwner)
	if i == nil || !ok {
		return
	}
	i.mu.Lock()
	delete(i.owners, replicaSetOwnerKey(owner.Namespace, owner.Name))
	i.mu.Unlock()
}

func (i *ReplicaSetOwnerIndex) ReplaceBundles(bundles []ingest.Bundle) {
	if i == nil {
		return
	}
	next := make(map[string]metav1.OwnerReference, len(bundles))
	for _, bundle := range bundles {
		if owner, ok := bundle.Aggregate.(ReplicaSetOwner); ok && owner.Name != "" {
			next[replicaSetOwnerKey(owner.Namespace, owner.Name)] = owner.Controller
		}
	}
	i.mu.Lock()
	i.owners = next
	i.mu.Unlock()
}

// SeedBundles fills the index from ReplicaSets restored from spill, which a
// resumed watch never re-delivers.
func (i *ReplicaSetOwnerIndex) SeedBundles(bundles []ingest.Bundle) {
	i.ReplaceBundles(bundles)
}
