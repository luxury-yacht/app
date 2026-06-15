/*
 * backend/resources/daemonset/objectmap.go
 *
 * DaemonSet's object-map status projection, co-located with its model.
 */

package daemonset

import (
	"github.com/luxury-yacht/app/backend/refresh/objectmap"
	appsv1 "k8s.io/api/apps/v1"
)

// ObjectMapStatus projects a DaemonSet into its object-map node status.
func ObjectMapStatus(clusterID string, ds appsv1.DaemonSet) *objectmap.Status {
	return objectmap.FromResourceModel(BuildResourceModel(clusterID, &ds))
}
