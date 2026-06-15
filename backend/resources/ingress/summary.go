/*
 * backend/resources/ingress/summary.go
 *
 * Ingress streaming summary projection, co-located with its model. Produces the
 * one-line description used by snapshot network summaries.
 */

package ingress

import (
	"fmt"
	"strings"
)

// DescribeSummary renders the one-line Ingress summary from its facts.
func DescribeSummary(facts Facts) string {
	parts := []string{}
	if facts.ClassName != "" {
		parts = append(parts, fmt.Sprintf("Class: %s", facts.ClassName))
	}
	if len(facts.Rules) > 0 {
		if len(facts.Hosts) > 0 {
			parts = append(parts, fmt.Sprintf("Hosts: %s", strings.Join(facts.Hosts, ",")))
		}
		parts = append(parts, fmt.Sprintf("Rules: %d", len(facts.Rules)))
	}
	if len(parts) == 0 {
		return "No rules defined"
	}
	return strings.Join(parts, ", ")
}
