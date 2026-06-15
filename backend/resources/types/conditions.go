/*
 * backend/resources/types/conditions.go
 *
 * Shared condition-string projection used by detail builders across resource
 * packages, so condition formatting lives in one place.
 */

package types

import (
	"fmt"

	"github.com/luxury-yacht/app/backend/resourcemodel"
)

// FormatConditions renders shared model ConditionFacts as display strings
// ("Type: Status (Reason) - Message"). Reason and Message segments are omitted
// when empty.
func FormatConditions(conditions []resourcemodel.ConditionFacts) []string {
	out := make([]string, 0, len(conditions))
	for _, c := range conditions {
		s := fmt.Sprintf("%s: %s", c.Type, c.Status)
		if c.Reason != "" {
			s += fmt.Sprintf(" (%s)", c.Reason)
		}
		if c.Message != "" {
			s += fmt.Sprintf(" - %s", c.Message)
		}
		out = append(out, s)
	}
	return out
}
