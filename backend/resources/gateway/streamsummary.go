/*
 * backend/resources/gateway/streamsummary.go
 *
 * Gateway's stream-summary builder, producing the neutral streamrows.NetworkSummary
 * row (namespace-network). No snapshot import.
 */

package gateway

import (
	"fmt"

	"github.com/luxury-yacht/app/backend/refresh/streamrows"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	gatewayv1 "sigs.k8s.io/gateway-api/apis/v1"
)

// BuildStreamSummary builds the namespace-network row for one Gateway.
func BuildStreamSummary(meta streamrows.ClusterMeta, gateway *gatewayv1.Gateway) streamrows.NetworkSummary {
	if gateway == nil {
		return streamrows.NetworkSummary{ClusterMeta: meta, Kind: "Gateway"}
	}
	return streamrows.NewNetworkSummary(meta, gateway, "Gateway", describeFacts(BuildFacts(meta.ClusterID, gateway)))
}

func describeFacts(facts Facts) string {
	className := ""
	if facts.Class != nil {
		className = resourcemodel.ResourceLinkName(*facts.Class)
	}
	if className == "" {
		return fmt.Sprintf("%d listener(s)", len(facts.Listeners))
	}
	return fmt.Sprintf("Class: %s, %d listener(s)", className, len(facts.Listeners))
}
