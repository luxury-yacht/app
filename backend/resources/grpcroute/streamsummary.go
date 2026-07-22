/*
 * backend/resources/grpcroute/streamsummary.go
 *
 * GRPCRoute's stream-summary builder, producing the neutral streamrows.NetworkSummary
 * row (namespace-network). No snapshot import.
 */

package grpcroute

import (
	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	gatewayv1 "sigs.k8s.io/gateway-api/apis/v1"
)

// BuildStreamSummary builds the namespace-network row for one GRPCRoute.
func BuildStreamSummary(meta streamrows.ClusterMeta, route *gatewayv1.GRPCRoute) streamrows.NetworkSummary {
	if route == nil {
		return streamrows.NetworkSummary{}
	}
	return streamrows.NewNetworkSummary(meta, Identity, route, resourcemodel.DescribeRouteFacts(BuildFacts(meta.ClusterID, route).RouteCommonFacts))
}
