/*
 * backend/resources/ingress/summary.go
 *
 * Ingress streaming summary projection, co-located with its model. Produces the
 * slotted Details segments used by snapshot network summaries.
 */

package ingress

import (
	"strconv"

	"github.com/luxury-yacht/app/backend/resourcemodel"
)

// SummarySegments renders the Ingress summary segments from its facts: the
// IngressClass as an openable reference, the hosts as a collapsed address
// list, and the rule count.
func SummarySegments(facts Facts) []resourcemodel.DetailSegment {
	segments := []resourcemodel.DetailSegment{}
	if facts.ClassName != "" {
		segments = append(segments, resourcemodel.DetailSegment{Slot: resourcemodel.DetailSlotReference, Label: "Class", Value: facts.ClassName, Link: facts.Class})
	}
	if hosts := resourcemodel.ListDetailSegment(resourcemodel.DetailSlotAddress, "Hosts", facts.Hosts); hosts.Value != "" {
		segments = append(segments, hosts)
	}
	return append(segments, resourcemodel.DetailSegment{Slot: resourcemodel.DetailSlotCounts, Label: "Rules", Value: strconv.Itoa(len(facts.Rules))})
}
