/*
 * backend/resources/listenerset/objectmap.go
 *
 * ListenerSet's object-map status projection, co-located with its model.
 */

package listenerset

import (
	"github.com/luxury-yacht/app/backend/refresh/objectmap"
	gatewayv1 "sigs.k8s.io/gateway-api/apis/v1"
)

// ObjectMapStatus projects a ListenerSet into its object-map node status.
func ObjectMapStatus(clusterID string, listenerSet gatewayv1.ListenerSet) *objectmap.Status {
	return objectmap.FromResourceModel(BuildResourceModel(clusterID, &listenerSet))
}
