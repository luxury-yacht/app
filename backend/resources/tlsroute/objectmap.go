/*
 * backend/resources/tlsroute/objectmap.go
 *
 * TLSRoute's object-map status projection, co-located with its model.
 */

package tlsroute

import (
	"github.com/luxury-yacht/app/backend/kind/objectmap"
	gatewayv1 "sigs.k8s.io/gateway-api/apis/v1"
)

// ObjectMapStatus projects a TLSRoute into its object-map node status.
func ObjectMapStatus(clusterID string, route gatewayv1.TLSRoute) *objectmap.Status {
	return objectmap.FromResourceModel(BuildResourceModel(clusterID, &route))
}
