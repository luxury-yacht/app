/*
 * backend/resources/clusterrole/summary.go
 *
 * ClusterRole summary projection. The streaming summary and the detail-view summary
 * are identical for ClusterRole (rules count + aggregated marker), so one function
 * serves both.
 */

package clusterrole

import "fmt"

// DescribeSummary renders the one-line ClusterRole summary used by both snapshot
// RBAC summaries and the detail view.
func DescribeSummary(facts Facts) string {
	summary := fmt.Sprintf("Rules: %d", len(facts.Rules))
	if facts.AggregationRule != nil {
		summary += " (aggregated)"
	}
	return summary
}
