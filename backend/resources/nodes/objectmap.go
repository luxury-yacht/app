/*
 * backend/resources/nodes/objectmap.go
 *
 * Node's object-map status projection, co-located with its model. (objectmap.Status
 * carries no badges, so the cordoned badge is dropped here as it was in the
 * snapshot's prior manual projection.)
 */

package nodes

import (
	"github.com/luxury-yacht/app/backend/kind/objectmap"
	corev1 "k8s.io/api/core/v1"
)

// ObjectMapStatus projects a Node into its object-map node status.
func ObjectMapStatus(clusterID string, node corev1.Node) *objectmap.Status {
	return objectmap.FromResourceModel(BuildResourceModel(clusterID, &node))
}
