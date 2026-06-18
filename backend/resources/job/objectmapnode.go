package job

import (
	"github.com/luxury-yacht/app/backend/kind/objectmap"
	"github.com/luxury-yacht/app/backend/kind/objectmapnode"
	"github.com/luxury-yacht/app/backend/resources/common"
	batchv1 "k8s.io/api/batch/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/labels"
	informers "k8s.io/client-go/informers"
)

// ObjectMapNode declares how the object map collects this kind from the shared
// informer cache and projects each object into a graph node.
var ObjectMapNode = objectmapnode.Collector{
	Identity: Identity,
	List: func(factory informers.SharedInformerFactory) ([]metav1.Object, error) {
		items, err := factory.Batch().V1().Jobs().Lister().List(labels.Everything())
		if err != nil {
			return nil, err
		}
		return objectmapnode.Objects(items), nil
	},
	Status: func(clusterID string, obj metav1.Object) *objectmap.Status {
		return ObjectMapStatus(clusterID, *obj.(*batchv1.Job))
	},
	ActionFacts: func(obj metav1.Object) *objectmap.ActionFacts {
		j, ok := obj.(*batchv1.Job)
		if !ok {
			return nil
		}
		available := common.HasForwardableContainerPorts(j.Spec.Template.Spec.Containers)
		return &objectmap.ActionFacts{PortForwardAvailable: &available}
	},
}
