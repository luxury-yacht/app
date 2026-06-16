/*
 * backend/resources/httproute/streamsummary.go
 *
 * HTTPRoute's stream-summary builder, producing the neutral streamrows.NetworkSummary
 * row (namespace-network). No snapshot import.
 */

package httproute

import (
	"github.com/luxury-yacht/app/backend/refresh/streamrows"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	gatewayv1 "sigs.k8s.io/gateway-api/apis/v1"
)

// BuildStreamSummary builds the namespace-network row for one HTTPRoute.
func BuildStreamSummary(meta streamrows.ClusterMeta, route *gatewayv1.HTTPRoute) streamrows.NetworkSummary {
	if route == nil {
		return streamrows.NetworkSummary{ClusterMeta: meta, Kind: "HTTPRoute"}
	}
	return streamrows.NewNetworkSummary(meta, route, "HTTPRoute", resourcemodel.DescribeRouteFacts(BuildFacts(meta.ClusterID, route).RouteCommonFacts))
}
