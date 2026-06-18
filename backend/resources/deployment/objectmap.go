/*
 * backend/resources/deployment/objectmap.go
 *
 * Deployment's object-map status projection, co-located with its model.
 */

package deployment

import (
	"github.com/luxury-yacht/app/backend/kind/objectmap"
	appsv1 "k8s.io/api/apps/v1"
)

// ObjectMapStatus projects a Deployment into its object-map node status.
func ObjectMapStatus(clusterID string, deploy appsv1.Deployment) *objectmap.Status {
	return objectmap.FromResourceModel(BuildResourceModel(clusterID, &deploy))
}
