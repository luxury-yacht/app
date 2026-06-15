/*
 * backend/resources/clusterrolebinding/summary.go
 *
 * ClusterRoleBinding summary projections: the terse streaming summary
 * (DescribeSummary) and the detail-view summary (detailsSummary).
 */

package clusterrolebinding

import (
	"fmt"

	"github.com/luxury-yacht/app/backend/resources/types"
)

// DescribeSummary renders the terse one-line ClusterRoleBinding summary used by
// snapshot RBAC summaries.
func DescribeSummary(facts Facts) string {
	role := types.RoleRefFromResourceLink(facts.RoleRef).Name
	if role == "" {
		role = "-"
	}
	return fmt.Sprintf("Role: %s, Subjects: %d", role, len(facts.Subjects))
}

// detailsSummary renders the ClusterRoleBinding detail-view summary.
func detailsSummary(facts Facts) string {
	roleRef := types.RoleRefFromResourceLink(facts.RoleRef)
	return fmt.Sprintf("Role: %s, Subjects: %d", roleRef.Name, len(facts.Subjects))
}
