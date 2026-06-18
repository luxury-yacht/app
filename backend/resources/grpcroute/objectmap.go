/*
 * backend/resources/grpcroute/objectmap.go
 *
 * GRPCRoute's object-map status projection, co-located with its model.
 */

package grpcroute

import (
	"github.com/luxury-yacht/app/backend/kind/objectmap"
	gatewayv1 "sigs.k8s.io/gateway-api/apis/v1"
)

// ObjectMapStatus projects a GRPCRoute into its object-map node status.
func ObjectMapStatus(clusterID string, route gatewayv1.GRPCRoute) *objectmap.Status {
	return objectmap.FromResourceModel(BuildResourceModel(clusterID, &route))
}
