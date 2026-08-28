/*
 * backend/resources/backendtlspolicy/streamsummary.go
 *
 * BackendTLSPolicy's stream-summary builder, producing the neutral
 * streamrows.NetworkSummary row (namespace-network). No snapshot import.
 */

package backendtlspolicy

import (
	"strconv"
	"strings"

	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	gatewayv1 "sigs.k8s.io/gateway-api/apis/v1"
)

// BuildStreamSummary builds the namespace-network row for one BackendTLSPolicy.
func BuildStreamSummary(meta streamrows.ClusterMeta, policy *gatewayv1.BackendTLSPolicy) streamrows.NetworkSummary {
	if policy == nil {
		return streamrows.NetworkSummary{}
	}
	facts := BuildFacts(meta.ClusterID, policy)
	details := []resourcemodel.DetailSegment{}
	if len(facts.TargetRefs) > 0 {
		if name := resourcemodel.ResourceLinkName(facts.TargetRefs[0]); name != "" {
			target := resourcemodel.DetailSegment{Slot: resourcemodel.DetailSlotReference, Label: "Target", Value: name, Link: &facts.TargetRefs[0]}
			if len(facts.TargetRefs) > 1 {
				names := make([]string, 0, len(facts.TargetRefs))
				for _, ref := range facts.TargetRefs {
					names = append(names, resourcemodel.ResourceLinkName(ref))
				}
				target.Search = strings.Join(names, ", ")
			}
			details = append(details, target)
		}
	}
	details = append(details, resourcemodel.DetailSegment{Slot: resourcemodel.DetailSlotCounts, Label: "Targets", Value: strconv.Itoa(len(facts.TargetRefs))})
	return streamrows.NewNetworkSummary(meta, Identity, policy, details)
}
