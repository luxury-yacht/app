/*
 * backend/resources/service/streamsummary.go
 *
 * Service's stream-summary builder, owned by the kind's package. Produces the
 * neutral streamrows.NetworkSummary row (namespace-network). The slices argument
 * carries the Service's EndpointSlices for its summary detail. No snapshot import.
 */

package service

import (
	"github.com/luxury-yacht/app/backend/kind/streamrows"
	corev1 "k8s.io/api/core/v1"
	discoveryv1 "k8s.io/api/discovery/v1"
)

// BuildStreamSummary builds the namespace-network row for one Service.
func BuildStreamSummary(meta streamrows.ClusterMeta, svc *corev1.Service, slices []*discoveryv1.EndpointSlice) streamrows.NetworkSummary {
	if svc == nil {
		return streamrows.NetworkSummary{ClusterMeta: meta, Kind: "Service"}
	}
	return streamrows.NewNetworkSummary(meta, Identity, svc, DescribeSummary(BuildFacts(svc, slices)))
}
