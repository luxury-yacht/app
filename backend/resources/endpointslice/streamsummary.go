/*
 * backend/resources/endpointslice/streamsummary.go
 *
 * EndpointSlice's stream-summary builder, owned by the kind's package. Produces
 * the neutral streamrows.NetworkSummary row (namespace-network). No snapshot import.
 */

package endpointslice

import (
	"github.com/luxury-yacht/app/backend/kind/streamrows"
	discoveryv1 "k8s.io/api/discovery/v1"
)

// BuildStreamSummary builds the namespace-network row for one EndpointSlice.
func BuildStreamSummary(meta streamrows.ClusterMeta, slice *discoveryv1.EndpointSlice) streamrows.NetworkSummary {
	if slice == nil {
		return streamrows.NetworkSummary{}
	}
	facts := BuildFacts(meta.ClusterID, slice)
	model := BuildResourceModel(meta.ClusterID, slice)
	return streamrows.NetworkSummary{
		Ref:          model.Ref,
		Details:      DescribeSummary(facts),
		Age:          streamrows.FormatAge(slice.CreationTimestamp.Time),
		AgeTimestamp: streamrows.CreationMillis(slice),
	}
}
