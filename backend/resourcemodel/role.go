package resourcemodel

import rbacv1 "k8s.io/api/rbac/v1"

func BuildRoleResourceModel(clusterID string, role *rbacv1.Role, bindings *rbacv1.RoleBindingList) ResourceModel {
	facts := BuildRoleFacts(clusterID, role, bindings)
	status := rbacRuleCountStatus(role.ObjectMeta, len(facts.Rules), false)
	return rbacResourceModel(clusterID, "Role", "roles", ResourceScopeNamespaced, role.ObjectMeta, status, ResourceFacts{Role: &facts})
}

func BuildRoleFacts(clusterID string, role *rbacv1.Role, bindings *rbacv1.RoleBindingList) RoleFacts {
	facts := RoleFacts{
		Rules: copyPolicyRuleFacts(role.Rules),
	}
	if bindings == nil {
		return facts
	}
	for _, binding := range bindings.Items {
		if binding.Namespace != role.Namespace {
			continue
		}
		if rbacRoleRefMatches(binding.RoleRef, "Role", role.Name) {
			facts.UsedByRoleBindings = append(facts.UsedByRoleBindings, rbacRoleBindingLink(clusterID, binding))
		}
	}
	sortRBACLinks(facts.UsedByRoleBindings)
	return facts
}
