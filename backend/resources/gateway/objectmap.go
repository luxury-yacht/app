/*
 * backend/resources/gateway/objectmap.go
 *
 * Gateway's object-map status projection, co-located with its model.
 */

package gateway

import (
	"github.com/luxury-yacht/app/backend/refresh/objectmap"
	gatewayv1 "sigs.k8s.io/gateway-api/apis/v1"
)

// ObjectMapStatus projects a Gateway into its object-map node status.
func ObjectMapStatus(clusterID string, gateway gatewayv1.Gateway) *objectmap.Status {
	return objectmap.FromResourceModel(BuildResourceModel(clusterID, &gateway))
}
