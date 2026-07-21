/*
 * backend/resources/listenerset/streamsummary.go
 *
 * ListenerSet's stream-summary builder, producing the neutral streamrows.NetworkSummary
 * row (namespace-network). No snapshot import.
 */

package listenerset

import (
	"fmt"

	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	gatewayv1 "sigs.k8s.io/gateway-api/apis/v1"
)

// BuildStreamSummary builds the namespace-network row for one ListenerSet.
func BuildStreamSummary(meta streamrows.ClusterMeta, listenerSet *gatewayv1.ListenerSet) streamrows.NetworkSummary {
	if listenerSet == nil {
		return streamrows.NetworkSummary{ClusterMeta: meta, Kind: "ListenerSet"}
	}
	facts := BuildFacts(meta.ClusterID, listenerSet)
	details := fmt.Sprintf("Parent: %s, %d listener(s)", resourcemodel.ResourceLinkName(facts.ParentRef), len(facts.Listeners))
	return streamrows.NewNetworkSummary(meta, Identity, listenerSet, details)
}
