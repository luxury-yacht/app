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
	return summarySegments(facts.PolicyTypes, len(facts.IngressRules)+len(facts.EgressRules))
}

func summarySegments(policyTypes []string, ruleCount int) []resourcemodel.DetailSegment {
	types := "Ingress"
	if len(policyTypes) > 0 {
		types = strings.Join(policyTypes, ", ")
	}
	return []resourcemodel.DetailSegment{
		{Slot: resourcemodel.DetailSlotReference, Label: "Policy", Value: types},
		{Slot: resourcemodel.DetailSlotCounts, Label: "Rules", Value: strconv.Itoa(ruleCount)},
	}
}
