package resourcemodel

import rbacv1 "k8s.io/api/rbac/v1"

func BuildClusterRoleResourceModel(
	clusterID string,
	role *rbacv1.ClusterRole,
	relationships *ResourceRelationshipIndex,
	options ...ResourceModelBuildOptions,
) ResourceModel {
	buildOptions := BuildOptions(options...)
	facts := BuildClusterRoleFacts(role, relationships, buildOptions)
	status := rbacRuleCountStatus(role.ObjectMeta, len(facts.Rules), facts.AggregationRule != nil)
	return rbacResourceModel(clusterID, "ClusterRole", "clusterroles", ResourceScopeCluster, role.ObjectMeta, status, ResourceFacts{ClusterRole: &facts})
}

func BuildClusterRoleFacts(
	role *rbacv1.ClusterRole,
	relationships *ResourceRelationshipIndex,
	options ResourceModelBuildOptions,
) ClusterRoleFacts {
	facts := ClusterRoleFacts{
		Rules: copyPolicyRuleFacts(role.Rules),
	}
	if role.AggregationRule != nil {
		facts.AggregationRule = &AggregationRuleFacts{}
		for _, selector := range role.AggregationRule.ClusterRoleSelectors {
			facts.AggregationRule.ClusterRoleSelectors = append(facts.AggregationRule.ClusterRoleSelectors, CopyStringMap(selector.MatchLabels))
		}
	}
	if options.Materialization.Has(MaterializeReverseLinks) && relationships != nil {
		facts.ClusterRoleBindings = relationships.ClusterRoleUsedByClusterBindings(role.Name)
		facts.RoleBindings = relationships.ClusterRoleUsedByRoleBindings(role.Name)
	}
	return facts
}
