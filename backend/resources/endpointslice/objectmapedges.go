package endpointslice

import (
	"github.com/luxury-yacht/app/backend/refresh/objectmapspec"
	discoveryv1 "k8s.io/api/discovery/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// ObjectMapEdges returns this EndpointSlice's edges to the objects its endpoints
// route to (each endpoint's targetRef).
func ObjectMapEdges(clusterID string, obj metav1.Object) []objectmapspec.Edge {
	slice, ok := obj.(*discoveryv1.EndpointSlice)
	if !ok {
		return nil
	}
	edges := make([]objectmapspec.Edge, 0, len(slice.Endpoints))
	for i := range slice.Endpoints {
		if slice.Endpoints[i].TargetRef == nil {
			continue
		}
		edges = append(edges, objectmapspec.Edge{Type: objectmapspec.EdgeEndpoint, Label: "routes to", TracedBy: "endpoints.targetRef", CoreObjectRef: slice.Endpoints[i].TargetRef})
	}
	return edges
}
