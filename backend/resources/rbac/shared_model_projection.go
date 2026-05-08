package rbac

import (
	"fmt"
	"sort"
	"strings"

	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/luxury-yacht/app/backend/resources/types"
)

func policyRulesFromFacts(facts []resourcemodel.PolicyRuleFacts) []types.PolicyRule {
	if len(facts) == 0 {
		return nil
	}
	rules := make([]types.PolicyRule, 0, len(facts))
	for _, fact := range facts {
		rules = append(rules, types.PolicyRule{
			APIGroups:       append([]string(nil), fact.APIGroups...),
			Resources:       append([]string(nil), fact.Resources...),
			ResourceNames:   append([]string(nil), fact.ResourceNames...),
			Verbs:           append([]string(nil), fact.Verbs...),
			NonResourceURLs: append([]string(nil), fact.NonResourceURLs...),
		})
	}
	return rules
}

func aggregationRuleFromFacts(facts *resourcemodel.AggregationRuleFacts) *types.AggregationRule {
	if facts == nil {
		return nil
	}
	rule := &types.AggregationRule{}
	for _, selector := range facts.ClusterRoleSelectors {
		next := make(map[string]string, len(selector))
		for key, value := range selector {
			next[key] = value
		}
		rule.ClusterRoleSelectors = append(rule.ClusterRoleSelectors, next)
	}
	return rule
}

func roleRefFromResourceLink(link resourcemodel.ResourceLink) types.RoleRef {
	if link.Ref != nil {
		return types.RoleRef{
			APIGroup: link.Ref.Group,
			Kind:     link.Ref.Kind,
			Name:     link.Ref.Name,
		}
	}
	if link.Display != nil {
		return types.RoleRef{
			APIGroup: link.Display.Group,
			Kind:     link.Display.Kind,
			Name:     link.Display.Name,
		}
	}
	return types.RoleRef{}
}

func subjectsFromFacts(facts []resourcemodel.SubjectFacts) []types.Subject {
	if len(facts) == 0 {
		return nil
	}
	subjects := make([]types.Subject, 0, len(facts))
	for _, fact := range facts {
		subjects = append(subjects, types.Subject{
			Kind:      fact.Kind,
			APIGroup:  fact.APIGroup,
			Name:      fact.Name,
			Namespace: fact.Namespace,
		})
	}
	return subjects
}

func roleDetailsSummary(facts *resourcemodel.RoleFacts) string {
	if facts == nil {
		return ""
	}
	resourceCount := 0
	verbCount := 0
	for _, rule := range facts.Rules {
		resourceCount += len(rule.Resources)
		verbCount += len(rule.Verbs)
	}
	summary := fmt.Sprintf("Rules: %d", len(facts.Rules))
	if resourceCount > 0 || verbCount > 0 {
		summary += fmt.Sprintf(" (%d resources, %d verbs)", resourceCount, verbCount)
	}
	if len(facts.UsedByRoleBindings) > 0 {
		summary += fmt.Sprintf(", Used by %d binding(s)", len(facts.UsedByRoleBindings))
	}
	return summary
}

func clusterRoleDetailsSummary(facts *resourcemodel.ClusterRoleFacts) string {
	if facts == nil {
		return ""
	}
	summary := fmt.Sprintf("Rules: %d", len(facts.Rules))
	if facts.AggregationRule != nil {
		summary += " (aggregated)"
	}
	return summary
}

func roleBindingDetailsSummary(facts *resourcemodel.RoleBindingFacts) string {
	if facts == nil {
		return ""
	}
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
	roleRef := roleRefFromResourceLink(facts.RoleRef)
	if roleRef.Name != "" {
		summary += fmt.Sprintf(", %s: %s", roleRef.Kind, roleRef.Name)
	}
	return summary
}

func clusterRoleBindingDetailsSummary(facts *resourcemodel.ClusterRoleBindingFacts) string {
	if facts == nil {
		return ""
	}
	roleRef := roleRefFromResourceLink(facts.RoleRef)
	return fmt.Sprintf("Role: %s, Subjects: %d", roleRef.Name, len(facts.Subjects))
}

func serviceAccountDetailsSummary(facts *resourcemodel.ServiceAccountFacts) string {
	if facts == nil {
		return ""
	}
	summary := fmt.Sprintf("Secrets: %d", len(facts.Secrets))
	if len(facts.ImagePullSecrets) > 0 {
		summary += fmt.Sprintf(", ImagePullSecrets: %d", len(facts.ImagePullSecrets))
	}
	if len(facts.UsedByPods) > 0 {
		summary += fmt.Sprintf(", Used by %d pod(s)", len(facts.UsedByPods))
	}
	if len(facts.RoleBindings) > 0 {
		summary += fmt.Sprintf(", RoleBindings: %d", len(facts.RoleBindings))
	}
	if len(facts.ClusterRoleBindings) > 0 {
		summary += fmt.Sprintf(", ClusterRoleBindings: %d", len(facts.ClusterRoleBindings))
	}
	return summary
}
