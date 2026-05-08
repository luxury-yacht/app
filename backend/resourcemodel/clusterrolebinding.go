package resourcemodel

import rbacv1 "k8s.io/api/rbac/v1"

func BuildClusterRoleBindingResourceModel(clusterID string, binding *rbacv1.ClusterRoleBinding) ResourceModel {
	facts := BuildClusterRoleBindingFacts(clusterID, binding)
	status := rbacBindingStatus(binding.ObjectMeta, binding.RoleRef.Name, len(facts.Subjects))
	return rbacResourceModel(clusterID, "ClusterRoleBinding", "clusterrolebindings", ResourceScopeCluster, binding.ObjectMeta, status, ResourceFacts{ClusterRoleBinding: &facts})
}

func BuildClusterRoleBindingFacts(clusterID string, binding *rbacv1.ClusterRoleBinding) ClusterRoleBindingFacts {
	return ClusterRoleBindingFacts{
		RoleRef:  rbacRoleRefLink(clusterID, "", binding.RoleRef),
		Subjects: rbacSubjectFactsList(clusterID, "", binding.Subjects),
	}
}
