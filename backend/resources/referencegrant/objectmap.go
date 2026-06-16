/*
 * backend/resources/referencegrant/objectmap.go
 *
 * ReferenceGrant's object-map status projection, co-located with its model.
 */

package referencegrant

import (
	"github.com/luxury-yacht/app/backend/refresh/objectmap"
	gatewayv1 "sigs.k8s.io/gateway-api/apis/v1"
)

// ObjectMapStatus projects a ReferenceGrant into its object-map node status.
func ObjectMapStatus(clusterID string, grant gatewayv1.ReferenceGrant) *objectmap.Status {
	return objectmap.FromResourceModel(BuildResourceModel(clusterID, &grant))
}
