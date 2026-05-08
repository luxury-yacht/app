package policy

import (
	"fmt"

	"github.com/luxury-yacht/app/backend/resourcemodel"
)

func pdbIntOrStringValue(facts *resourcemodel.IntOrStringFacts) *string {
	if facts == nil {
		return nil
	}
	value := facts.Value
	return &value
}

func pdbConditionStrings(facts []resourcemodel.ConditionFacts) []string {
	if len(facts) == 0 {
		return nil
	}
	result := make([]string, 0, len(facts))
	for _, condition := range facts {
		desc := fmt.Sprintf("%s: %s", condition.Type, condition.Status)
		if condition.Reason != "" {
			desc += fmt.Sprintf(" (%s)", condition.Reason)
		}
		if condition.Message != "" {
			desc += fmt.Sprintf(" - %s", condition.Message)
		}
		result = append(result, desc)
	}
	return result
}

func pdbDetailsSummary(facts *resourcemodel.PodDisruptionBudgetFacts) string {
	if facts == nil {
		return ""
	}
	selectorSummary := "No selector"
	if len(facts.Selector) > 0 {
		selectorSummary = fmt.Sprintf("Selector: %d labels", len(facts.Selector))
	}
	availability := ""
	if facts.MinAvailable != nil {
		availability = fmt.Sprintf(", MinAvailable: %s", facts.MinAvailable.Value)
	}
	if facts.MaxUnavailable != nil {
		availability += fmt.Sprintf(", MaxUnavailable: %s", facts.MaxUnavailable.Value)
	}
	status := fmt.Sprintf(", Healthy: %d/%d, Disruptions Allowed: %d",
		facts.CurrentHealthy, facts.DesiredHealthy, facts.AllowedDisruptions)
	return selectorSummary + availability + status
}
