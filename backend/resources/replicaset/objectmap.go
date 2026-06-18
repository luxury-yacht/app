/*
 * backend/resources/replicaset/objectmap.go
 *
 * ReplicaSet's object-map status projection, co-located with its model.
 */

package replicaset

import (
	"github.com/luxury-yacht/app/backend/kind/objectmap"
	appsv1 "k8s.io/api/apps/v1"
)

// ObjectMapStatus projects a ReplicaSet into its object-map node status.
func ObjectMapStatus(clusterID string, rs appsv1.ReplicaSet) *objectmap.Status {
	return objectmap.FromResourceModel(BuildResourceModel(clusterID, &rs))
}
