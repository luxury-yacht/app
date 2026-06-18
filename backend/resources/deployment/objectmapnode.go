package deployment

import (
	"github.com/luxury-yacht/app/backend/kind/objectmap"
	"github.com/luxury-yacht/app/backend/kind/objectmapnode"
	"github.com/luxury-yacht/app/backend/resources/common"
	appsv1 "k8s.io/api/apps/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/labels"
	informers "k8s.io/client-go/informers"
)

// ObjectMapNode declares how the object map collects this kind from the shared
// informer cache and projects each object into a graph node.
var ObjectMapNode = objectmapnode.Collector{
	Identity: Identity,
	List: func(factory informers.SharedInformerFactory) ([]metav1.Object, error) {
		items, err := factory.Apps().V1().Deployments().Lister().List(labels.Everything())
		if err != nil {
			return nil, err
		}
		return objectmapnode.Objects(items), nil
	},
	Status: func(clusterID string, obj metav1.Object) *objectmap.Status {
		return ObjectMapStatus(clusterID, *obj.(*appsv1.Deployment))
	},
	ActionFacts: func(obj metav1.Object) *objectmap.ActionFacts {
		workload, ok := obj.(*appsv1.Deployment)
		if !ok {
			return nil
		}
		available := common.HasForwardableContainerPorts(workload.Spec.Template.Spec.Containers)
		return &objectmap.ActionFacts{PortForwardAvailable: &available, DesiredReplicas: workload.Spec.Replicas}
	},
}
