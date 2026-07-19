package hpa

import (
	"github.com/luxury-yacht/app/backend/kind/objectmapspec"
	autoscalingv2 "k8s.io/api/autoscaling/v2"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// ObjectMapEdges returns this HPA's relationship-graph edges (it scales its target).
func ObjectMapEdges(clusterID string, obj metav1.Object) []objectmapspec.Edge {
	var edge objectmapspec.Edge
	switch hpa := obj.(type) {
	case *autoscalingv2.HorizontalPodAutoscaler:
		edge = objectmapspec.Edge{Type: objectmapspec.EdgeScales, Link: BuildFacts(clusterID, hpa).ScaleTarget}
	default:
		return nil
	}
	return []objectmapspec.Edge{edge}
}
