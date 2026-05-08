package resourcemodel

import rbacv1 "k8s.io/api/rbac/v1"

func BuildClusterRoleResourceModel(
	clusterID string,
	role *rbacv1.ClusterRole,
	clusterRoleBindings *rbacv1.ClusterRoleBindingList,
	roleBindings *rbacv1.RoleBindingList,
) ResourceModel {
	facts := BuildClusterRoleFacts(clusterID, role, clusterRoleBindings, roleBindings)
	status := rbacRuleCountStatus(role.ObjectMeta, len(facts.Rules), facts.AggregationRule != nil)
	return rbacResourceModel(clusterID, "ClusterRole", "clusterroles", ResourceScopeCluster, role.ObjectMeta, status, ResourceFacts{ClusterRole: &facts})
}

func BuildClusterRoleFacts(
	clusterID string,
	role *rbacv1.ClusterRole,
	clusterRoleBindings *rbacv1.ClusterRoleBindingList,
	roleBindings *rbacv1.RoleBindingList,
) ClusterRoleFacts {
	facts := ClusterRoleFacts{
		Rules: copyPolicyRuleFacts(role.Rules),
	}
	if role.AggregationRule != nil {
		facts.AggregationRule = &AggregationRuleFacts{}
		for _, selector := range role.AggregationRule.ClusterRoleSelectors {
			facts.AggregationRule.ClusterRoleSelectors = append(facts.AggregationRule.ClusterRoleSelectors, copyStringMap(selector.MatchLabels))
		}
	}
	if clusterRoleBindings != nil {
		for _, binding := range clusterRoleBindings.Items {
			if rbacRoleRefMatches(binding.RoleRef, "ClusterRole", role.Name) {
				facts.ClusterRoleBindings = append(facts.ClusterRoleBindings, rbacClusterRoleBindingLink(clusterID, binding))
			}
		}
		sortRBACLinks(facts.ClusterRoleBindings)
	}
	if roleBindings != nil {
		for _, binding := range roleBindings.Items {
			if rbacRoleRefMatches(binding.RoleRef, "ClusterRole", role.Name) {
				facts.RoleBindings = append(facts.RoleBindings, rbacRoleBindingLink(clusterID, binding))
			}
		}
		sortRBACLinks(facts.RoleBindings)
	}
	return facts
}
