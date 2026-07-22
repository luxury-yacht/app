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
