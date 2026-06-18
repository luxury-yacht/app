/*
 * backend/resources/serviceaccount/summary.go
 *
 * ServiceAccount summary projections: the terse streaming summary (DescribeSummary)
 * and the richer detail-view summary (detailsSummary).
 */

package serviceaccount

import "fmt"

// DescribeSummary renders the terse one-line ServiceAccount summary used by snapshot
// RBAC summaries.
func DescribeSummary(facts Facts) string {
	return fmt.Sprintf("Secrets: %d", len(facts.Secrets))
}

// detailsSummary renders the richer ServiceAccount detail-view summary.
func detailsSummary(facts Facts) string {
	summary := fmt.Sprintf("Secrets: %d", len(facts.Secrets))
	if len(facts.ImagePullSecrets) > 0 {
		summary += fmt.Sprintf(", ImagePullSecrets: %d", len(facts.ImagePullSecrets))
	}
	if len(facts.UsedByPods) > 0 {
		summary += fmt.Sprintf(", Used by %d pod(s)", len(facts.UsedByPods))
	}
	if len(facts.RoleBindings) > 0 {
		summary += fmt.Sprintf(", RoleBindings: %d", len(facts.RoleBindings))
	}
	if len(facts.ClusterRoleBindings) > 0 {
		summary += fmt.Sprintf(", ClusterRoleBindings: %d", len(facts.ClusterRoleBindings))
	}
	return summary
}
