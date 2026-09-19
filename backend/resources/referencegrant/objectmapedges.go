package referencegrant

import (
	"github.com/luxury-yacht/app/backend/kind/objectmapspec"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	gatewayv1 "sigs.k8s.io/gateway-api/apis/v1"
)

// ObjectMapEdges returns this ReferenceGrant's grant edges to its allowed targets.
func ObjectMapEdges(clusterID string, obj metav1.Object) []objectmapspec.Edge {
	grant, ok := obj.(*gatewayv1.ReferenceGrant)
	if !ok {
		return nil
	}
	edges := make([]objectmapspec.Edge, 0, len(grant.Spec.To))
	for _, to := range grant.Spec.To {
		edges = append(edges, objectmapspec.Edge{Type: objectmapspec.EdgeGrants, TracedBy: "spec.to", Link: resourcemodel.GatewayReferenceGrantToLink(clusterID, grant.Namespace, to)})
	}
	return edges
}
