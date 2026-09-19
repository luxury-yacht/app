/*
 * backend/resources/clusterrolebinding/model.go
 *
 * ClusterRoleBinding resource model: the single definition of a ClusterRoleBinding's
 * intrinsic fields + status presentation. Shared rbac helpers are reused from
 * resourcemodel (exported rbac base).
 */

package clusterrolebinding

import (
	"github.com/luxury-yacht/app/backend/resourcemodel"
	rbacv1 "k8s.io/api/rbac/v1"
)

// BuildResourceModel builds the ClusterRoleBinding resource model. Facts are owned
// by this package (clusterrolebinding.Facts); callers needing facts use BuildFacts.
func BuildResourceModel(clusterID string, binding *rbacv1.ClusterRoleBinding) resourcemodel.ResourceModel {
	status := resourcemodel.RBACBindingStatus(binding.ObjectMeta, binding.RoleRef.Name, len(binding.Subjects))
	return resourcemodel.KubernetesResourceModel(clusterID, Identity, binding.ObjectMeta, status)
}

// BuildFacts extracts the ClusterRoleBinding facts from the raw object.
func BuildFacts(clusterID string, binding *rbacv1.ClusterRoleBinding) Facts {
	return Facts{
		RoleRef:  resourcemodel.RBACRoleRefLink(clusterID, "", binding.RoleRef),
		Subjects: resourcemodel.RBACSubjectFactsList(clusterID, "", binding.Subjects),
	}
}
