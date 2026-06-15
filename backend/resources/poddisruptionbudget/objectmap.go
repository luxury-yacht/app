/*
 * backend/resources/poddisruptionbudget/objectmap.go
 *
 * PodDisruptionBudget's object-map status projection, co-located with its model.
 */

package poddisruptionbudget

import (
	"github.com/luxury-yacht/app/backend/refresh/objectmap"
	policyv1 "k8s.io/api/policy/v1"
)

// ObjectMapStatus projects a PodDisruptionBudget into its object-map node status.
func ObjectMapStatus(clusterID string, pdb policyv1.PodDisruptionBudget) *objectmap.Status {
	return objectmap.FromResourceModel(BuildResourceModel(clusterID, &pdb))
}
