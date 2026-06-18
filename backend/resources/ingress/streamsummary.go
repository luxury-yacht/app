/*
 * backend/resources/ingress/streamsummary.go
 *
 * Ingress's stream-summary builder, owned by the kind's package. Produces the
 * neutral streamrows.NetworkSummary row (namespace-network). No snapshot import.
 */

package ingress

import (
	"github.com/luxury-yacht/app/backend/kind/streamrows"
	networkingv1 "k8s.io/api/networking/v1"
)

// BuildStreamSummary builds the namespace-network row for one Ingress.
func BuildStreamSummary(meta streamrows.ClusterMeta, ing *networkingv1.Ingress) streamrows.NetworkSummary {
	if ing == nil {
		return streamrows.NetworkSummary{ClusterMeta: meta, Kind: "Ingress"}
	}
	return streamrows.NewNetworkSummary(meta, ing, "Ingress", DescribeSummary(BuildFacts(meta.ClusterID, ing)))
}
