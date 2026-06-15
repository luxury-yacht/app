/*
 * backend/resources/resourcequota/summary.go
 *
 * Streaming-row summary description for ResourceQuota (consumed by newQuotaSummary).
 */

package resourcequota

import "fmt"

// DescribeSummary formats the ResourceQuota streaming-row detail string from its facts.
func DescribeSummary(facts Facts) string {
	return fmt.Sprintf("Hard: %d, Used: %d", len(facts.Hard), len(facts.Used))
}
