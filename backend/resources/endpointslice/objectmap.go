/*
 * backend/resources/endpointslice/objectmap.go
 *
 * EndpointSlice's object-map status projection, co-located with its model.
 */

package endpointslice

import (
	"github.com/luxury-yacht/app/backend/kind/objectmap"
	discoveryv1 "k8s.io/api/discovery/v1"
)

// ObjectMapStatus projects an EndpointSlice into its object-map node status.
func ObjectMapStatus(clusterID string, slice discoveryv1.EndpointSlice) *objectmap.Status {
	return objectmap.FromResourceModel(BuildResourceModel(clusterID, &slice))
}
