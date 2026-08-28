/*
 * backend/resources/gateway/streamsummary.go
 *
 * Gateway's stream-summary builder, producing the neutral streamrows.NetworkSummary
 * row (namespace-network). No snapshot import.
 */

package gateway

import (
	"strconv"

	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	gatewayv1 "sigs.k8s.io/gateway-api/apis/v1"
)

// BuildStreamSummary builds the namespace-network row for one Gateway.
func BuildStreamSummary(meta streamrows.ClusterMeta, gateway *gatewayv1.Gateway) streamrows.NetworkSummary {
	if gateway == nil {
		return streamrows.NetworkSummary{}
	}
	return streamrows.NewNetworkSummary(meta, Identity, gateway, summarySegments(BuildFacts(meta.ClusterID, gateway)))
}

func summarySegments(facts Facts) []resourcemodel.DetailSegment {
	segments := []resourcemodel.DetailSegment{}
	if facts.Class != nil {
		if className := resourcemodel.ResourceLinkName(*facts.Class); className != "" {
			segments = append(segments, resourcemodel.DetailSegment{Slot: resourcemodel.DetailSlotReference, Value: className, Link: facts.Class})
		}
	}
	if addresses := resourcemodel.ListDetailSegment(resourcemodel.DetailSlotAddress, facts.Addresses); addresses.Value != "" {
		segments = append(segments, addresses)
	}
	return append(segments, resourcemodel.DetailSegment{Slot: resourcemodel.DetailSlotCounts, Label: "Listeners", Value: strconv.Itoa(len(facts.Listeners))})
}
