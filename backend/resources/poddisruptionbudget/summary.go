/*
 * backend/resources/poddisruptionbudget/summary.go
 *
 * Streaming-row summary description for PodDisruptionBudget, co-located with the
 * model. Consumed by the snapshot streaming layer (newQuotaSummary).
 */

package poddisruptionbudget

import (
	"fmt"
	"strings"
)

// DescribeSummary formats the PDB streaming-row detail string from its facts.
func DescribeSummary(facts Facts) string {
	parts := []string{}
	if facts.MinAvailable != nil {
		parts = append(parts, fmt.Sprintf("MinAvailable: %s", facts.MinAvailable.Value))
	}
	if facts.MaxUnavailable != nil {
		parts = append(parts, fmt.Sprintf("MaxUnavailable: %s", facts.MaxUnavailable.Value))
	}
	parts = append(parts, fmt.Sprintf("Disruptions Allowed: %d", facts.AllowedDisruptions))
	return strings.Join(parts, ", ")
}
