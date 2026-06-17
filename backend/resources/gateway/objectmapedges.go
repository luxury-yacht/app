package gateway

import (
	"github.com/luxury-yacht/app/backend/refresh/objectmapspec"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	gatewayv1 "sigs.k8s.io/gateway-api/apis/v1"
)

// ObjectMapEdges returns this Gateway's edge to its GatewayClass.
func ObjectMapEdges(clusterID string, obj metav1.Object) []objectmapspec.Edge {
	gateway, ok := obj.(*gatewayv1.Gateway)
	if !ok {
		return nil
	}
	class := BuildFacts(clusterID, gateway).Class
	if class == nil {
		return nil
	}
	return []objectmapspec.Edge{{Type: objectmapspec.EdgeUses, Label: "uses class", TracedBy: "spec.gatewayClassName", Link: *class}}
}
