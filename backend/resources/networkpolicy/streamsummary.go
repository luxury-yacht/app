/*
 * backend/resources/networkpolicy/streamsummary.go
 *
 * NetworkPolicy's stream-summary builder, owned by the kind's package. Produces
 * the neutral streamrows.NetworkSummary row (namespace-network). No snapshot import.
 */

package networkpolicy

import (
	"github.com/luxury-yacht/app/backend/kind/streamrows"
	networkingv1 "k8s.io/api/networking/v1"
)

// BuildStreamSummary builds the namespace-network row for one NetworkPolicy.
func BuildStreamSummary(meta streamrows.ClusterMeta, policy *networkingv1.NetworkPolicy) streamrows.NetworkSummary {
	if policy == nil {
		return streamrows.NetworkSummary{}
	}
	return streamrows.NewNetworkSummary(meta, Identity, policy, DescribeSummary(BuildFacts(policy)))
}
