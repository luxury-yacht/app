/*
 * backend/resources/clusterrole/model.go
 *
 * ClusterRole resource model: the single definition of a ClusterRole's intrinsic
 * fields + status presentation. Reverse links (binding usage) materialize from the
 * shared relationship index only when requested. Shared rbac helpers are reused
 * from resourcemodel (exported rbac base).
 */

package clusterrole

import (
	"github.com/luxury-yacht/app/backend/resourcemodel"
	rbacv1 "k8s.io/api/rbac/v1"
)

// BuildResourceModel builds the ClusterRole resource model. Facts are owned by
// this package (clusterrole.Facts); callers needing facts use BuildFacts.
func BuildResourceModel(clusterID string, role *rbacv1.ClusterRole, relationships *resourcemodel.ResourceRelationshipIndex, options ...resourcemodel.ResourceModelBuildOptions) resourcemodel.ResourceModel {
	buildOptions := resourcemodel.BuildOptions(options...)
	facts := BuildFacts(role, relationships, buildOptions)
	status := resourcemodel.RBACRuleCountStatus(role.ObjectMeta, len(facts.Rules), facts.AggregationRule != nil)
	return resourcemodel.RBACResourceModel(clusterID, "ClusterRole", "clusterroles", resourcemodel.ResourceScopeCluster, role.ObjectMeta, status, resourcemodel.ResourceFacts{})
}

// BuildFacts extracts the ClusterRole facts. Reverse links materialize only when
// the MaterializeReverseLinks flag is set and a relationship index is supplied.
func BuildFacts(role *rbacv1.ClusterRole, relationships *resourcemodel.ResourceRelationshipIndex, options resourcemodel.ResourceModelBuildOptions) Facts {
	facts := Facts{
		Rules: resourcemodel.CopyPolicyRuleFacts(role.Rules),
	}
	if role.AggregationRule != nil {
		facts.AggregationRule = &AggregationRuleFacts{}
		for _, selector := range role.AggregationRule.ClusterRoleSelectors {
			facts.AggregationRule.ClusterRoleSelectors = append(facts.AggregationRule.ClusterRoleSelectors, resourcemodel.CopyStringMap(selector.MatchLabels))
		}
	}
	if options.Materialization.Has(resourcemodel.MaterializeReverseLinks) && relationships != nil {
		facts.ClusterRoleBindings = relationships.ClusterRoleUsedByClusterBindings(role.Name)
		facts.RoleBindings = relationships.ClusterRoleUsedByRoleBindings(role.Name)
	}
	return facts
}
