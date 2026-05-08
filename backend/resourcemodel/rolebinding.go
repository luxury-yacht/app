package resourcemodel

import rbacv1 "k8s.io/api/rbac/v1"

func BuildRoleBindingResourceModel(clusterID string, binding *rbacv1.RoleBinding) ResourceModel {
	facts := BuildRoleBindingFacts(clusterID, binding)
	status := rbacBindingStatus(binding.ObjectMeta, binding.RoleRef.Name, len(facts.Subjects))
	return rbacResourceModel(clusterID, "RoleBinding", "rolebindings", ResourceScopeNamespaced, binding.ObjectMeta, status, ResourceFacts{RoleBinding: &facts})
}

func BuildRoleBindingFacts(clusterID string, binding *rbacv1.RoleBinding) RoleBindingFacts {
	return RoleBindingFacts{
		RoleRef:  rbacRoleRefLink(clusterID, binding.Namespace, binding.RoleRef),
		Subjects: rbacSubjectFactsList(clusterID, binding.Namespace, binding.Subjects),
	}
}
