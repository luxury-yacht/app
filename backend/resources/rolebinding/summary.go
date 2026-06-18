/*
 * backend/resources/rolebinding/summary.go
 *
 * RoleBinding summary projections: the terse streaming summary (DescribeSummary)
 * and the richer detail-view summary (detailsSummary), co-located with the model.
 */

package rolebinding

import (
	"fmt"
	"sort"
	"strings"

	"github.com/luxury-yacht/app/backend/resources/types"
)

// DescribeSummary renders the terse one-line RoleBinding summary used by snapshot
// RBAC summaries.
func DescribeSummary(facts Facts) string {
	role := types.RoleRefFromResourceLink(facts.RoleRef).Name
	if role == "" {
		role = "-"
	}
	return fmt.Sprintf("Role: %s, Subjects: %d", role, len(facts.Subjects))
}

// detailsSummary renders the richer RoleBinding detail-view summary.
func detailsSummary(facts Facts) string {
	subjectTypes := make(map[string]int)
	for _, subject := range facts.Subjects {
		subjectTypes[subject.Kind]++
	}
	summary := fmt.Sprintf("Subjects: %d", len(facts.Subjects))
	if len(subjectTypes) > 0 {
		kinds := make([]string, 0, len(subjectTypes))
		for kind := range subjectTypes {
			kinds = append(kinds, kind)
		}
		sort.Strings(kinds)
		parts := make([]string, 0, len(kinds))
		for _, kind := range kinds {
			parts = append(parts, fmt.Sprintf("%d %s", subjectTypes[kind], kind))
		}
		summary += " (" + strings.Join(parts, ", ") + ")"
	}
	roleRef := types.RoleRefFromResourceLink(facts.RoleRef)
	if roleRef.Name != "" {
		summary += fmt.Sprintf(", %s: %s", roleRef.Kind, roleRef.Name)
	}
	return summary
}
