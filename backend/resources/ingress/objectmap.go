/*
 * backend/resources/ingress/objectmap.go
 *
 * Ingress's object-map status projection, co-located with its model.
 */

package ingress

import (
	"github.com/luxury-yacht/app/backend/refresh/objectmap"
	networkingv1 "k8s.io/api/networking/v1"
)

// ObjectMapStatus projects an Ingress into its object-map node status.
func ObjectMapStatus(clusterID string, ingress networkingv1.Ingress) *objectmap.Status {
	return objectmap.FromResourceModel(BuildResourceModel(clusterID, &ingress))
}
