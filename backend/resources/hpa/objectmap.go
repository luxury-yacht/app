/*
 * backend/resources/hpa/objectmap.go
 *
 * HorizontalPodAutoscaler's object-map status projection, co-located with its
 * model. The object map uses the v2 model.
 */

package hpa

import (
	"github.com/luxury-yacht/app/backend/refresh/objectmap"
	autoscalingv2 "k8s.io/api/autoscaling/v2"
)

// ObjectMapStatus projects a HorizontalPodAutoscaler into its object-map node status.
func ObjectMapStatus(clusterID string, h autoscalingv2.HorizontalPodAutoscaler) *objectmap.Status {
	return objectmap.FromResourceModel(BuildResourceModel(clusterID, &h))
}
