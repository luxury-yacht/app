/*
 * backend/resources/pods/objectmap.go
 *
 * Pod's object-map status projection, co-located with its model.
 */

package pods

import (
	"github.com/luxury-yacht/app/backend/kind/objectmap"
	corev1 "k8s.io/api/core/v1"
)

// ObjectMapStatus projects a Pod into its object-map node status.
func ObjectMapStatus(clusterID string, pod corev1.Pod) *objectmap.Status {
	return objectmap.FromResourceModel(BuildResourceModel(clusterID, &pod))
}
