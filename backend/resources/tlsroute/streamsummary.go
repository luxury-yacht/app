/*
 * backend/resources/tlsroute/streamsummary.go
 *
 * TLSRoute's stream-summary builder, producing the neutral streamrows.NetworkSummary
 * row (namespace-network). No snapshot import.
 */

package tlsroute

import (
	"github.com/luxury-yacht/app/backend/refresh/streamrows"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	gatewayv1 "sigs.k8s.io/gateway-api/apis/v1"
)

// BuildStreamSummary builds the namespace-network row for one TLSRoute.
func BuildStreamSummary(meta streamrows.ClusterMeta, route *gatewayv1.TLSRoute) streamrows.NetworkSummary {
	if route == nil {
		return streamrows.NetworkSummary{ClusterMeta: meta, Kind: "TLSRoute"}
	}
	return streamrows.NewNetworkSummary(meta, route, "TLSRoute", resourcemodel.DescribeRouteFacts(BuildFacts(meta.ClusterID, route).RouteCommonFacts))
}
