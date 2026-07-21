/*
 * backend/resources/backendtlspolicy/streamsummary.go
 *
 * BackendTLSPolicy's stream-summary builder, producing the neutral
 * streamrows.NetworkSummary row (namespace-network). No snapshot import.
 */

package backendtlspolicy

import (
	"fmt"

	"github.com/luxury-yacht/app/backend/kind/streamrows"
	gatewayv1 "sigs.k8s.io/gateway-api/apis/v1"
)

// BuildStreamSummary builds the namespace-network row for one BackendTLSPolicy.
func BuildStreamSummary(meta streamrows.ClusterMeta, policy *gatewayv1.BackendTLSPolicy) streamrows.NetworkSummary {
	if policy == nil {
		return streamrows.NetworkSummary{ClusterMeta: meta, Kind: "BackendTLSPolicy"}
	}
	facts := BuildFacts(meta.ClusterID, policy)
	return streamrows.NewNetworkSummary(meta, Identity, policy, fmt.Sprintf("%d target(s)", len(facts.TargetRefs)))
}
