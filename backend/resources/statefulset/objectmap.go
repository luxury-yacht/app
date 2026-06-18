/*
 * backend/resources/statefulset/objectmap.go
 *
 * StatefulSet's object-map status projection, co-located with its model. The
 * snapshot collector calls this; the neutral objectmap package lets it produce
 * the status without importing snapshot.
 */

package statefulset

import (
	"github.com/luxury-yacht/app/backend/kind/objectmap"
	appsv1 "k8s.io/api/apps/v1"
)

// ObjectMapStatus projects a StatefulSet into its object-map node status.
func ObjectMapStatus(clusterID string, sts appsv1.StatefulSet) *objectmap.Status {
	return objectmap.FromResourceModel(BuildResourceModel(clusterID, &sts))
}
