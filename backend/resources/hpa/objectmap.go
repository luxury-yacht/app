/*
 * backend/resources/hpa/objectmap.go
 *
 * HorizontalPodAutoscaler's object-map status projection, co-located with its
 * model. The synchronized v1 informer supplies the projection.
 */

package hpa

import (
	"github.com/luxury-yacht/app/backend/kind/objectmap"
	autoscalingv1 "k8s.io/api/autoscaling/v1"
)

// ObjectMapStatus projects the informer-backed v1 representation into its
// object-map node status.
func ObjectMapStatus(clusterID string, h *autoscalingv1.HorizontalPodAutoscaler) *objectmap.Status {
	return objectmap.FromResourceModel(BuildV1ResourceModel(clusterID, h))
}
