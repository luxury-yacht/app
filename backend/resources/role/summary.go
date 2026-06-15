/*
 * backend/resources/role/summary.go
 *
 * Role summary projections: the terse streaming summary (DescribeSummary) and the
 * richer detail-view summary (detailsSummary), co-located with the model.
 */

package role

import "fmt"

// DescribeSummary renders the terse one-line Role summary used by snapshot RBAC
// summaries.
func DescribeSummary(facts Facts) string {
	return fmt.Sprintf("Rules: %d", len(facts.Rules))
}

// detailsSummary renders the richer Role detail-view summary.
func detailsSummary(facts Facts) string {
	resourceCount := 0
	verbCount := 0
	for _, rule := range facts.Rules {
		resourceCount += len(rule.Resources)
		verbCount += len(rule.Verbs)
	}
	summary := fmt.Sprintf("Rules: %d", len(facts.Rules))
	if resourceCount > 0 || verbCount > 0 {
		summary += fmt.Sprintf(" (%d resources, %d verbs)", resourceCount, verbCount)
	}
	if len(facts.UsedByRoleBindings) > 0 {
		summary += fmt.Sprintf(", Used by %d binding(s)", len(facts.UsedByRoleBindings))
	}
	return summary
}
