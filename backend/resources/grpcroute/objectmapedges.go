package grpcroute

import (
	"github.com/luxury-yacht/app/backend/kind/objectmapspec"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	gatewayv1 "sigs.k8s.io/gateway-api/apis/v1"
)

// ObjectMapEdges returns this route's edges to its parents and backends.
func ObjectMapEdges(clusterID string, obj metav1.Object) []objectmapspec.Edge {
	route, ok := obj.(*gatewayv1.GRPCRoute)
	if !ok {
		return nil
	}
	return objectmapspec.RouteEdges(BuildFacts(clusterID, route).RouteCommonFacts)
}
