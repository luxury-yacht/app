/*
 * backend/resources/service/objectmap.go
 *
 * Service's object-map status projection, co-located with its model. The object
 * map does not enumerate EndpointSlices, so endpoint facts are computed from nil
 * slices (status reflects type/load-balancer state, not endpoint health).
 */

package service

import (
	"github.com/luxury-yacht/app/backend/refresh/objectmap"
	corev1 "k8s.io/api/core/v1"
)

// ObjectMapStatus projects a Service into its object-map node status.
func ObjectMapStatus(clusterID string, svc corev1.Service) *objectmap.Status {
	return objectmap.FromResourceModel(BuildResourceModel(clusterID, &svc, nil))
}
