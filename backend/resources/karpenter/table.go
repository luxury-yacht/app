package karpenter

import (
	"fmt"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	"sort"
	"strings"
)

func TableDetails(facts *Facts) []resourcemodel.DetailSegment {
	if facts == nil {
		return nil
	}
	var details []resourcemodel.DetailSegment
	for _, entry := range []struct {
		label string
		link  *resourcemodel.ResourceLink
	}{
		{"NodePool", facts.NodePool}, {"NodeClass", facts.NodeClass}, {"Node", facts.Node},
	} {
		if entry.link == nil {
			continue
		}
		name := ""
		if entry.link.Ref != nil {
			name = entry.link.Ref.Name
		} else if entry.link.Display != nil {
			name = entry.link.Display.Name
		}
		details = append(details, resourcemodel.DetailSegment{Slot: resourcemodel.DetailSlotReference, Label: entry.label, Value: name, Link: entry.link})
	}
	details = appendValues(details, resourcemodel.DetailSlotReference, []labeledValue{
		{"Instance", facts.InstanceType}, {"Capacity type", facts.CapacityType}, {"Image family", facts.ImageFamily},
	})
	details = appendValues(details, resourcemodel.DetailSlotCounts, []labeledValue{
		{"Capacity", quantityText(facts.Capacity)}, {"Limits", quantityText(facts.Limits)},
		{"Weight", numberText(facts.Weight)}, {"Replicas", numberText(facts.Replicas)},
	})
	return appendValues(details, resourcemodel.DetailSlotConfiguration, []labeledValue{
		{"Consolidation", facts.ConsolidationPolicy}, {"Expire after", facts.ExpireAfter}, {"Zone", facts.Zone},
		{"Role", facts.Role}, {"Instance profile", facts.InstanceProfile}, {"Price adjustment", facts.PriceAdjustment},
	})
}

type labeledValue struct{ label, value string }

func appendValues(details []resourcemodel.DetailSegment, slot string, values []labeledValue) []resourcemodel.DetailSegment {
	for _, entry := range values {
		if entry.value != "" {
			details = append(details, resourcemodel.DetailSegment{Slot: slot, Label: entry.label, Value: entry.value})
		}
	}
	return details
}
func quantityText(values map[string]string) string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(keys))
	for _, key := range keys {
		parts = append(parts, key+" "+values[key])
	}
	return strings.Join(parts, ", ")
}
func numberText(value *int64) string {
	if value == nil {
		return ""
	}
	return fmt.Sprint(*value)
}
