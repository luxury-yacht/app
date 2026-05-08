package resourcemodel

import rbacv1 "k8s.io/api/rbac/v1"

func BuildRoleResourceModel(clusterID string, role *rbacv1.Role, relationships *ResourceRelationshipIndex, options ...ResourceModelBuildOptions) ResourceModel {
	buildOptions := BuildOptions(options...)
	facts := BuildRoleFacts(role, relationships, buildOptions)
	status := rbacRuleCountStatus(role.ObjectMeta, len(facts.Rules), false)
	return rbacResourceModel(clusterID, "Role", "roles", ResourceScopeNamespaced, role.ObjectMeta, status, ResourceFacts{Role: &facts})
}

func BuildRoleFacts(role *rbacv1.Role, relationships *ResourceRelationshipIndex, options ResourceModelBuildOptions) RoleFacts {
	facts := RoleFacts{
		Rules: copyPolicyRuleFacts(role.Rules),
	}
	if options.Materialization.Has(MaterializeReverseLinks) && relationships != nil {
		facts.UsedByRoleBindings = relationships.RoleUsedByBindings(role.Namespace, role.Name)
	}
	return facts
}
