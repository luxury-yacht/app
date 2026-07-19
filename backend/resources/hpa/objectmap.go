/*
 * backend/resources/hpa/objectmap.go
 *
 * HorizontalPodAutoscaler's object-map status projection, co-located with its
 * model. The synchronized v2 informer preserves the primary API's conditions.
 */

package hpa

import (
	"github.com/luxury-yacht/app/backend/kind/objectmap"
	autoscalingv2 "k8s.io/api/autoscaling/v2"
)

// ObjectMapStatus projects the informer-backed v2 representation into its
// object-map node status.
func ObjectMapStatus(clusterID string, h *autoscalingv2.HorizontalPodAutoscaler) *objectmap.Status {
	return objectmap.FromResourceModel(BuildResourceModel(clusterID, h))
}
