/*
 * backend/resources/httproute/objectmap.go
 *
 * HTTPRoute's object-map status projection, co-located with its model.
 */

package httproute

import (
	"github.com/luxury-yacht/app/backend/refresh/objectmap"
	gatewayv1 "sigs.k8s.io/gateway-api/apis/v1"
)

// ObjectMapStatus projects an HTTPRoute into its object-map node status.
func ObjectMapStatus(clusterID string, route gatewayv1.HTTPRoute) *objectmap.Status {
	return objectmap.FromResourceModel(BuildResourceModel(clusterID, &route))
}
