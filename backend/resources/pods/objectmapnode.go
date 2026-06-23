package pods

import (
	"github.com/luxury-yacht/app/backend/kind/objectmap"
	"github.com/luxury-yacht/app/backend/kind/objectmapnode"
	"github.com/luxury-yacht/app/backend/resources/common"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	informers "k8s.io/client-go/informers"
)

// ObjectMapNode declares how the object map projects a Pod into a graph node. Pods is
// an owned-reflector ingest kind (IngestOwned): the object map reads pod nodes from the
// ingest projections (collectIngestNodes), never via List, so List returns no items and
// never touches the shared informer — keeping the pod typed informer uninstantiated.
// Status, ActionFacts, and the descriptor's Edges still project each pod at ingest
// intake (NewPodIngestProjector), so the graph node is byte-identical to the lister path.
var ObjectMapNode = objectmapnode.Collector{
	Identity: Identity,
	List: func(informers.SharedInformerFactory) ([]metav1.Object, error) {
		return nil, nil
	},
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
