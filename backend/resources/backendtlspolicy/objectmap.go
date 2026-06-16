/*
 * backend/resources/backendtlspolicy/objectmap.go
 *
 * BackendTLSPolicy's object-map status projection, co-located with its model.
 */

package backendtlspolicy

import (
	"github.com/luxury-yacht/app/backend/refresh/objectmap"
	gatewayv1 "sigs.k8s.io/gateway-api/apis/v1"
)

// ObjectMapStatus projects a BackendTLSPolicy into its object-map node status.
func ObjectMapStatus(clusterID string, policy gatewayv1.BackendTLSPolicy) *objectmap.Status {
	return objectmap.FromResourceModel(BuildResourceModel(clusterID, &policy))
}
