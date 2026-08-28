/*
 * backend/resources/networkpolicy/summary.go
 *
 * Streaming-row summary segments for NetworkPolicy, co-located with the model.
 * Consumed by the snapshot streaming layer.
 */

package networkpolicy

import (
	"strconv"
	"strings"

	"github.com/luxury-yacht/app/backend/resourcemodel"
)

// SummarySegments renders the NetworkPolicy summary segments from its facts:
// the policy types (reference slot; an unset list defaults to Ingress,
// matching the API default) and the total rule count.
func SummarySegments(facts Facts) []resourcemodel.DetailSegment {
	types := "Ingress"
	if len(facts.PolicyTypes) > 0 {
		types = strings.Join(facts.PolicyTypes, ", ")
	}
	return []resourcemodel.DetailSegment{
		{Slot: resourcemodel.DetailSlotReference, Value: types},
		{Slot: resourcemodel.DetailSlotCounts, Label: "Rules", Value: strconv.Itoa(len(facts.IngressRules) + len(facts.EgressRules))},
	}
}
