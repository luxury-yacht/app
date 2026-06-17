package listenerset

import (
	"github.com/luxury-yacht/app/backend/refresh/objectmapspec"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	gatewayv1 "sigs.k8s.io/gateway-api/apis/v1"
)

// ObjectMapEdges returns this ListenerSet's edge to its parent Gateway.
func ObjectMapEdges(clusterID string, obj metav1.Object) []objectmapspec.Edge {
	listenerSet, ok := obj.(*gatewayv1.ListenerSet)
	if !ok {
		return nil
	}
	return []objectmapspec.Edge{{Type: objectmapspec.EdgeUses, TracedBy: "spec.parentRef", Link: BuildFacts(clusterID, listenerSet).ParentRef}}
}
