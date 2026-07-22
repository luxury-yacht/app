/*
 * backend/resources/referencegrant/streamsummary.go
 *
 * ReferenceGrant's stream-summary builder, producing the neutral
 * streamrows.NetworkSummary row (namespace-network). No snapshot import.
 */

package referencegrant

import (
	"fmt"

	"github.com/luxury-yacht/app/backend/kind/streamrows"
	gatewayv1 "sigs.k8s.io/gateway-api/apis/v1"
)

// BuildStreamSummary builds the namespace-network row for one ReferenceGrant.
func BuildStreamSummary(meta streamrows.ClusterMeta, grant *gatewayv1.ReferenceGrant) streamrows.NetworkSummary {
	if grant == nil {
		return streamrows.NetworkSummary{}
	}
	facts := BuildFacts(meta.ClusterID, grant)
	details := fmt.Sprintf("%d from, %d to", len(facts.From), len(facts.To))
	return streamrows.NewNetworkSummary(meta, Identity, grant, details)
}
