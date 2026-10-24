package nodes

import (
	"github.com/luxury-yacht/app/backend/kind/objectmap"
	"github.com/luxury-yacht/app/backend/kind/objectmapnode"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// ObjectMapNode declares how the object map projects a Node into a graph node. The object
// map reads node graph nodes from the owned reflector's projections (collectIngestNodes);
// Status and ActionFacts project each node at intake (NewNodeIngestProjector).
var ObjectMapNode = objectmapnode.Collector{
	Identity: Identity,
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
