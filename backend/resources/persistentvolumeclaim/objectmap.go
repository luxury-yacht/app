/*
 * backend/resources/persistentvolumeclaim/objectmap.go
 *
 * PersistentVolumeClaim's object-map status projection, co-located with its model.
 */

package persistentvolumeclaim

import (
	"github.com/luxury-yacht/app/backend/kind/objectmap"
	corev1 "k8s.io/api/core/v1"
)

// ObjectMapStatus projects a PersistentVolumeClaim into its object-map node status.
func ObjectMapStatus(clusterID string, pvc corev1.PersistentVolumeClaim) *objectmap.Status {
	return objectmap.FromResourceModel(BuildResourceModel(clusterID, &pvc))
}
