/*
 * backend/resources/networkpolicy/objectmap.go
 *
 * NetworkPolicy's object-map status projection, co-located with its model.
 */

package networkpolicy

import (
	"github.com/luxury-yacht/app/backend/kind/objectmap"
	networkingv1 "k8s.io/api/networking/v1"
)

// ObjectMapStatus projects a NetworkPolicy into its object-map node status.
func ObjectMapStatus(clusterID string, policy networkingv1.NetworkPolicy) *objectmap.Status {
	return objectmap.FromResourceModel(BuildResourceModel(clusterID, &policy))
}
