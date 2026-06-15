/*
 * backend/resources/clusterrolebinding/objectmap.go
 *
 * ClusterRoleBinding's object-map status projection, co-located with its model.
 */

package clusterrolebinding

import (
	"github.com/luxury-yacht/app/backend/refresh/objectmap"
	rbacv1 "k8s.io/api/rbac/v1"
)

// ObjectMapStatus projects a ClusterRoleBinding into its object-map node status.
func ObjectMapStatus(clusterID string, binding rbacv1.ClusterRoleBinding) *objectmap.Status {
	return objectmap.FromResourceModel(BuildResourceModel(clusterID, &binding))
}
