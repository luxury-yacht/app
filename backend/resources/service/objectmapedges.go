package service

import (
	"github.com/luxury-yacht/app/backend/kind/objectmapspec"
	corev1 "k8s.io/api/core/v1"
	discoveryv1 "k8s.io/api/discovery/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// ObjectMapEdges returns this Service's edge: it has its endpoint slices. A
// Service reaches Pods only through them, as traffic does; its selector is the
// EndpointSlice controller's input, not a link of its own.
func ObjectMapEdges(clusterID string, obj metav1.Object) []objectmapspec.Edge {
	if _, ok := obj.(*corev1.Service); !ok {
		return nil
	}
	return []objectmapspec.Edge{{Type: objectmapspec.EdgeEndpoint, TracedBy: discoveryv1.LabelServiceName, ServiceSlices: true}}
}
