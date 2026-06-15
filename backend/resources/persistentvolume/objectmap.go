/*
 * backend/resources/persistentvolume/objectmap.go
 *
 * PersistentVolume's object-map status projection, co-located with its model.
 */

package persistentvolume

import (
	"github.com/luxury-yacht/app/backend/refresh/objectmap"
	corev1 "k8s.io/api/core/v1"
)

// ObjectMapStatus projects a PersistentVolume into its object-map node status.
func ObjectMapStatus(clusterID string, pv corev1.PersistentVolume) *objectmap.Status {
	return objectmap.FromResourceModel(BuildResourceModel(clusterID, &pv))
}
