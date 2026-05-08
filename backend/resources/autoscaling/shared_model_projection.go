package autoscaling

import (
	"fmt"

	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/luxury-yacht/app/backend/resources/types"
)

func scaleTargetReferenceFromFacts(link resourcemodel.ResourceLink) types.ScaleTargetReference {
	kind, name := scaleTargetKindName(link)
	return types.ScaleTargetReference{
		Kind:       kind,
		Name:       name,
		APIVersion: scaleTargetAPIVersion(link),
	}
}

func metricSpecsFromFacts(facts []resourcemodel.MetricFacts) []types.MetricSpec {
	if len(facts) == 0 {
		return nil
	}
	result := make([]types.MetricSpec, 0, len(facts))
	for _, fact := range facts {
		result = append(result, types.MetricSpec{
			Kind:   fact.Kind,
			Target: copyStringMap(fact.Target),
		})
	}
	return result
}

func metricStatusesFromFacts(facts []resourcemodel.MetricStatusFacts) []types.MetricStatus {
	if len(facts) == 0 {
		return nil
	}
	result := make([]types.MetricStatus, 0, len(facts))
	for _, fact := range facts {
		result = append(result, types.MetricStatus{
			Kind:    fact.Kind,
			Current: copyStringMap(fact.Current),
		})
	}
	return result
}

func scalingBehaviorFromFacts(facts *resourcemodel.ScalingBehaviorFacts) *types.ScalingBehavior {
	if facts == nil {
		return nil
	}
	return &types.ScalingBehavior{
		ScaleUp:   scalingRulesFromFacts(facts.ScaleUp),
		ScaleDown: scalingRulesFromFacts(facts.ScaleDown),
	}
}

func scalingRulesFromFacts(facts *resourcemodel.ScalingRulesFacts) *types.ScalingRules {
	if facts == nil {
		return nil
	}
	return &types.ScalingRules{
		StabilizationWindowSeconds: facts.StabilizationWindowSeconds,
		SelectPolicy:               facts.SelectPolicy,
		Policies:                   append([]string(nil), facts.Policies...),
	}
}

func hpaConditionStrings(facts []resourcemodel.ConditionFacts) []string {
	if len(facts) == 0 {
		return nil
	}
	result := make([]string, 0, len(facts))
	for _, condition := range facts {
		cond := fmt.Sprintf("%s: %s", condition.Type, condition.Status)
		if condition.Reason != "" {
			cond += fmt.Sprintf(" (%s)", condition.Reason)
		}
		if condition.Message != "" {
			cond += fmt.Sprintf(" - %s", condition.Message)
		}
		result = append(result, cond)
	}
	return result
}

func hpaDetailsSummary(facts *resourcemodel.HorizontalPodAutoscalerFacts) string {
	if facts == nil {
		return ""
	}
	kind, name := scaleTargetKindName(facts.ScaleTarget)
	minReplicas := int32(1)
	if facts.MinReplicas != nil {
		minReplicas = *facts.MinReplicas
	}
	return fmt.Sprintf("Target: %s/%s, Replicas: %d/%d/%d", kind, name, minReplicas, facts.CurrentReplicas, facts.MaxReplicas)
}

func scaleTargetKindName(link resourcemodel.ResourceLink) (string, string) {
	if link.Ref != nil {
		return link.Ref.Kind, link.Ref.Name
	}
	if link.Display != nil {
		return link.Display.Kind, link.Display.Name
	}
	return "", ""
}

func scaleTargetAPIVersion(link resourcemodel.ResourceLink) string {
	if link.Ref != nil {
		if link.Ref.Group == "" {
			return link.Ref.Version
		}
		return link.Ref.Group + "/" + link.Ref.Version
	}
	if link.Display != nil {
		if link.Display.Group == "" {
			return link.Display.Version
		}
		return link.Display.Group + "/" + link.Display.Version
	}
	return ""
}

func copyStringMap(values map[string]string) map[string]string {
	if len(values) == 0 {
		return nil
	}
	result := make(map[string]string, len(values))
	for key, value := range values {
		result[key] = value
	}
	return result
}
