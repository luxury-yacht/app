/*
 * backend/resources/clusterrole/summary.go
 *
 * ClusterRole summary projection. The streaming summary and the detail-view summary
 * are identical for ClusterRole (rules count + aggregated marker), so one function
 * serves both.
 */

package clusterrole

import "github.com/luxury-yacht/app/backend/resourcemodel"

// DescribeSummary renders the one-line ClusterRole summary used by both snapshot
// RBAC summaries and the detail view.
func DescribeSummary(facts Facts) string {
	return resourcemodel.RBACRuleSummary(len(facts.Rules), facts.AggregationRule != nil)
}
