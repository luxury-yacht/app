/*
 * backend/resources/ingressclass/objectmap.go
 *
 * IngressClass's object-map status projection, co-located with its model.
 */

package ingressclass

import (
	"github.com/luxury-yacht/app/backend/kind/objectmap"
	networkingv1 "k8s.io/api/networking/v1"
)

// ObjectMapStatus projects an IngressClass into its object-map node status.
func ObjectMapStatus(clusterID string, ingressClass networkingv1.IngressClass) *objectmap.Status {
	return objectmap.FromResourceModel(BuildResourceModel(clusterID, &ingressClass))
}
