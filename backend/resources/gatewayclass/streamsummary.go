/*
 * backend/resources/gatewayclass/streamsummary.go
 *
 * GatewayClass's stream-summary builder, producing the neutral
 * streamrows.ClusterConfigEntry row (cluster-config). No snapshot import.
 */

package gatewayclass

import (
	"github.com/luxury-yacht/app/backend/refresh/streamrows"
	gatewayv1 "sigs.k8s.io/gateway-api/apis/v1"
)

// BuildStreamSummary builds the cluster-config row for one GatewayClass.
func BuildStreamSummary(meta streamrows.ClusterMeta, gc *gatewayv1.GatewayClass) streamrows.ClusterConfigEntry {
	if gc == nil {
		return streamrows.ClusterConfigEntry{ClusterMeta: meta, Kind: "GatewayClass"}
	}
	details := BuildFacts(meta.ClusterID, gc).ControllerName
	return streamrows.NewClusterConfigEntry(meta, gc, "GatewayClass", details, false)
}
