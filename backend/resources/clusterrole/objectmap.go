/*
 * backend/resources/clusterrole/objectmap.go
 *
 * ClusterRole's object-map status projection, co-located with its model. The object
 * map does not materialize reverse links (nil relationships).
 */

package clusterrole

import (
	"github.com/luxury-yacht/app/backend/refresh/objectmap"
	rbacv1 "k8s.io/api/rbac/v1"
)

// ObjectMapStatus projects a ClusterRole into its object-map node status.
func ObjectMapStatus(clusterID string, role rbacv1.ClusterRole) *objectmap.Status {
	return objectmap.FromResourceModel(BuildResourceModel(clusterID, &role, nil))
}
