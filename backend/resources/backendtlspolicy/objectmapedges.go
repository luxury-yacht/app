package backendtlspolicy

import (
	"github.com/luxury-yacht/app/backend/refresh/objectmapspec"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	gatewayv1 "sigs.k8s.io/gateway-api/apis/v1"
)

// ObjectMapEdges returns this BackendTLSPolicy's edges to the backends it targets.
func ObjectMapEdges(clusterID string, obj metav1.Object) []objectmapspec.LinkEdge {
	policy, ok := obj.(*gatewayv1.BackendTLSPolicy)
	if !ok {
		return nil
	}
	facts := BuildFacts(clusterID, policy)
	edges := make([]objectmapspec.LinkEdge, 0, len(facts.TargetRefs))
	for _, ref := range facts.TargetRefs {
		edges = append(edges, objectmapspec.LinkEdge{Type: objectmapspec.EdgeUses, TracedBy: "spec.targetRefs", Link: ref})
	}
	return edges
}
