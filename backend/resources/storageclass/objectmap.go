/*
 * backend/resources/storageclass/objectmap.go
 *
 * StorageClass's object-map status projection, co-located with its model.
 */

package storageclass

import (
	"github.com/luxury-yacht/app/backend/kind/objectmap"
	storagev1 "k8s.io/api/storage/v1"
)

// ObjectMapStatus projects a StorageClass into its object-map node status.
func ObjectMapStatus(clusterID string, storageClass storagev1.StorageClass) *objectmap.Status {
	return objectmap.FromResourceModel(BuildResourceModel(clusterID, &storageClass))
}
