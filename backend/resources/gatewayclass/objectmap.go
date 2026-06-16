/*
 * backend/resources/gatewayclass/objectmap.go
 *
 * GatewayClass's object-map status projection, co-located with its model.
 */

package gatewayclass

import (
	"github.com/luxury-yacht/app/backend/refresh/objectmap"
	gatewayv1 "sigs.k8s.io/gateway-api/apis/v1"
)

// ObjectMapStatus projects a GatewayClass into its object-map node status.
func ObjectMapStatus(clusterID string, gatewayClass gatewayv1.GatewayClass) *objectmap.Status {
	return objectmap.FromResourceModel(BuildResourceModel(clusterID, &gatewayClass))
}
