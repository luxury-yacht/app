package gatewayclass

import (
	"github.com/luxury-yacht/app/backend/refresh/objectmapspec"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	gatewayv1 "sigs.k8s.io/gateway-api/apis/v1"
)

// ObjectMapEdges returns this GatewayClass's edge to its parameters resource.
func ObjectMapEdges(clusterID string, obj metav1.Object) []objectmapspec.LinkEdge {
	gatewayClass, ok := obj.(*gatewayv1.GatewayClass)
	if !ok {
		return nil
	}
	facts := BuildFacts(clusterID, gatewayClass)
	if facts.Parameters == nil {
		return nil
	}
	return []objectmapspec.LinkEdge{{Type: objectmapspec.EdgeUses, TracedBy: "spec.parametersRef", Link: *facts.Parameters}}
}
