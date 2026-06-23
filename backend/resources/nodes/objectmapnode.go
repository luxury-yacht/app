package nodes

import (
	"github.com/luxury-yacht/app/backend/kind/objectmap"
	"github.com/luxury-yacht/app/backend/kind/objectmapnode"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	informers "k8s.io/client-go/informers"
)

// ObjectMapNode declares how the object map projects a Node into a graph node. Nodes is an
// owned-reflector ingest kind (IngestOwned): the object map reads node graph nodes from the
// ingest projections (collectIngestNodes), never via List, so List returns no items and never
// touches the shared informer — keeping the node typed informer uninstantiated. Status and
// ActionFacts still project each node at ingest intake (NewNodeIngestProjector), so the graph
// node is byte-identical to the lister path.
var ObjectMapNode = objectmapnode.Collector{
	Identity: Identity,
	List: func(informers.SharedInformerFactory) ([]metav1.Object, error) {
		return nil, nil
	},
	Status: func(clusterID string, obj metav1.Object) *objectmap.Status {
		return ObjectMapStatus(clusterID, *obj.(*corev1.Node))
	},
	ActionFacts: func(obj metav1.Object) *objectmap.ActionFacts {
		node, ok := obj.(*corev1.Node)
		if !ok {
			return nil
		}
		unschedulable := node.Spec.Unschedulable
		return &objectmap.ActionFacts{Unschedulable: &unschedulable}
	},
}
