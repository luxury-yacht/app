/*
 * backend/resources/backendtlspolicy/streamsummary.go
 *
 * BackendTLSPolicy's stream-summary builder, producing the neutral
 * streamrows.NetworkSummary row (namespace-network). No snapshot import.
 */

package backendtlspolicy

import (
	"strconv"

	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	gatewayv1 "sigs.k8s.io/gateway-api/apis/v1"
)

// BuildStreamSummary builds the namespace-network row for one BackendTLSPolicy.
func BuildStreamSummary(meta streamrows.ClusterMeta, policy *gatewayv1.BackendTLSPolicy) streamrows.NetworkSummary {
	if policy == nil {
		return streamrows.NetworkSummary{}
	}
	targets := targetLinks(meta.ClusterID, policy)
	details := []resourcemodel.DetailSegment{}
	if target := resourcemodel.FirstLinkDetailSegment("Target", targets); target.Value != "" {
		details = append(details, target)
	}
	details = append(details, resourcemodel.DetailSegment{Slot: resourcemodel.DetailSlotCounts, Label: "Targets", Value: strconv.Itoa(len(targets))})
	return streamrows.NewNetworkSummary(meta, Identity, policy, details)
}
