package service

import (
	"github.com/luxury-yacht/app/backend/kind/objectmapspec"
	corev1 "k8s.io/api/core/v1"
	discoveryv1 "k8s.io/api/discovery/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// ObjectMapEdges returns this Service's edges: it has its endpoint slices and (when
// it has a selector) selects the pods behind it.
func ObjectMapEdges(clusterID string, obj metav1.Object) []objectmapspec.Edge {
	svc, ok := obj.(*corev1.Service)
	if !ok {
		return nil
	}
	edges := []objectmapspec.Edge{{Type: objectmapspec.EdgeEndpoint, TracedBy: discoveryv1.LabelServiceName, ServiceSlices: true}}
	if len(svc.Spec.Selector) > 0 {
		edges = append(edges, objectmapspec.Edge{Type: objectmapspec.EdgeSelector, PodsSelector: svc.Spec.Selector})
	}
	return edges
}
