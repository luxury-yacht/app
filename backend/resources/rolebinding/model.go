/*
 * backend/resources/rolebinding/model.go
 *
 * RoleBinding resource model: the single definition of a RoleBinding's intrinsic
 * fields + status presentation. Shared rbac helpers are reused from resourcemodel
 * (exported rbac base).
 */

package rolebinding

import (
	"github.com/luxury-yacht/app/backend/resourcemodel"
	rbacv1 "k8s.io/api/rbac/v1"
)

// BuildFacts extracts the RoleBinding facts from the raw object.
func BuildFacts(clusterID string, binding *rbacv1.RoleBinding) Facts {
	return Facts{
		RoleRef:  resourcemodel.RBACRoleRefLink(clusterID, binding.Namespace, binding.RoleRef),
		Subjects: resourcemodel.RBACSubjectFactsList(clusterID, binding.Namespace, binding.Subjects),
	}
}
