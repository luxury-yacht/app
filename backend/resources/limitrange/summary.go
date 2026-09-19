/*
 * backend/resources/limitrange/summary.go
 *
 * Streaming-row summary description for LimitRange (consumed by newQuotaSummary).
 */

package limitrange

import "fmt"

// DescribeSummary formats the LimitRange streaming-row detail string from its facts.
func DescribeSummary(facts Facts) string {
	return describeCounts(len(facts.Limits))
}

func describeCounts(count int) string {
	return fmt.Sprintf("Limits: %d", count)
}
