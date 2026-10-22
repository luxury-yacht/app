package hpa

import (
	"github.com/luxury-yacht/app/backend/kind/objectmap"
	"github.com/luxury-yacht/app/backend/kind/objectmapnode"
	autoscalingv2 "k8s.io/api/autoscaling/v2"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// ObjectMapNode declares how the object map projects HorizontalPodAutoscalers:
// as v2 graph nodes, whose status keeps the conditions only v2 represents.
var ObjectMapNode = objectmapnode.Collector{
	Identity: Identity,
	Status: func(clusterID string, obj metav1.Object) *objectmap.Status {
		hpa, ok := obj.(*autoscalingv2.HorizontalPodAutoscaler)
		if !ok {
			return nil
		}
		return ObjectMapStatus(clusterID, hpa)
	},
}
