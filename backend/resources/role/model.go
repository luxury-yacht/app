/*
 * backend/resources/role/model.go
 *
 * Role resource model: the single definition of a Role's intrinsic fields + status
 * presentation. Reverse links (UsedByRoleBindings) materialize from the shared
 * relationship index only when requested. Shared rbac helpers are reused from
 * resourcemodel (exported rbac base).
 */

package role

import (
	"github.com/luxury-yacht/app/backend/resourcemodel"
	rbacv1 "k8s.io/api/rbac/v1"
)

// BuildResourceModel builds the Role resource model. Facts are owned by this
// package (role.Facts); callers needing facts use BuildFacts.
func BuildResourceModel(clusterID string, r *rbacv1.Role, relationships *resourcemodel.ResourceRelationshipIndex, options ...resourcemodel.ResourceModelBuildOptions) resourcemodel.ResourceModel {
	buildOptions := resourcemodel.BuildOptions(options...)
	facts := BuildFacts(r, relationships, buildOptions)
	status := resourcemodel.RBACRuleCountStatus(r.ObjectMeta, len(facts.Rules), false)
	return resourcemodel.RBACResourceModel(clusterID, "Role", "roles", resourcemodel.ResourceScopeNamespaced, r.ObjectMeta, status, resourcemodel.ResourceFacts{})
}

// BuildFacts extracts the Role facts. Reverse links materialize only when the
// MaterializeReverseLinks flag is set and a relationship index is supplied.
func BuildFacts(r *rbacv1.Role, relationships *resourcemodel.ResourceRelationshipIndex, options resourcemodel.ResourceModelBuildOptions) Facts {
	facts := Facts{
		Rules: resourcemodel.CopyPolicyRuleFacts(r.Rules),
	}
	if options.Materialization.Has(resourcemodel.MaterializeReverseLinks) && relationships != nil {
		facts.UsedByRoleBindings = relationships.RoleUsedByBindings(r.Namespace, r.Name)
	}
	return facts
}
