package hpa

import (
	"github.com/luxury-yacht/app/backend/kind/objectmapspec"
	autoscalingv2 "k8s.io/api/autoscaling/v2"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// ObjectMapEdges returns this HPA's relationship-graph edges (it scales its target).
func ObjectMapEdges(clusterID string, obj metav1.Object) []objectmapspec.Edge {
	hpa, ok := obj.(*autoscalingv2.HorizontalPodAutoscaler)
	if !ok {
		return nil
	}
	target := hpa.Spec.ScaleTargetRef
	link := scaleTargetLink(clusterID, hpa.Namespace, target.APIVersion, target.Kind, target.Name)
	return []objectmapspec.Edge{{Type: objectmapspec.EdgeScales, Link: link}}
}
