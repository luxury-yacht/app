package hpa

import (
	"github.com/luxury-yacht/app/backend/kind/objectmap"
	"github.com/luxury-yacht/app/backend/kind/objectmapnode"
	autoscalingv2 "k8s.io/api/autoscaling/v2"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/labels"
	informers "k8s.io/client-go/informers"
)

// ObjectMapNode declares how the object map collects HorizontalPodAutoscalers:
// from the synchronized autoscaling/v2 informer, whose objects keep the primary
// API's conditions, as v2 graph nodes.
var ObjectMapNode = objectmapnode.Collector{
	Identity: Identity,
	List: func(factory informers.SharedInformerFactory) ([]metav1.Object, error) {
		items, err := factory.Autoscaling().V2().HorizontalPodAutoscalers().Lister().List(labels.Everything())
		if err != nil {
			return nil, err
		}
		return objectmapnode.Objects(items), nil
	},
	Status: func(clusterID string, obj metav1.Object) *objectmap.Status {
		hpa, ok := obj.(*autoscalingv2.HorizontalPodAutoscaler)
		if !ok {
			return nil
		}
		return ObjectMapStatus(clusterID, hpa)
	},
}
