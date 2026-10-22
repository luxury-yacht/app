package pods

import (
	"github.com/luxury-yacht/app/backend/kind/objectmap"
	"github.com/luxury-yacht/app/backend/kind/objectmapnode"
	"github.com/luxury-yacht/app/backend/resources/common"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// ObjectMapNode declares how the object map projects a Pod into a graph node. The object
// map reads pod nodes from the owned reflector's projections (collectIngestNodes); Status,
// ActionFacts, and the descriptor's Edges project each pod at intake (NewPodIngestProjector).
var ObjectMapNode = objectmapnode.Collector{
	Identity: Identity,
	Status: func(clusterID string, obj metav1.Object) *objectmap.Status {
		return ObjectMapStatus(clusterID, *obj.(*corev1.Pod))
	},
	ActionFacts: func(obj metav1.Object) *objectmap.ActionFacts {
		pod, ok := obj.(*corev1.Pod)
		if !ok {
			return nil
		}
		available := common.HasForwardableContainerPorts(pod.Spec.Containers)
		return &objectmap.ActionFacts{PortForwardAvailable: &available}
	},
}
