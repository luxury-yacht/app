/*
 * backend/resources/types/rbac.go
 *
 * Shared RBAC detail converters. The PolicyRule/Subject/RoleRef DTO sub-types are
 * shared across two rbac kinds each (PolicyRule: Role+ClusterRole; Subject/RoleRef:
 * RoleBinding+ClusterRoleBinding), so their facts→DTO converters live here next to
 * the sub-types rather than being duplicated per kind package.
 */

package types

import "github.com/luxury-yacht/app/backend/resourcemodel"

// PolicyRulesFromFacts converts shared policy-rule facts into the DTO sub-type.
func PolicyRulesFromFacts(facts []resourcemodel.PolicyRuleFacts) []PolicyRule {
	if len(facts) == 0 {
		return nil
	}
	rules := make([]PolicyRule, 0, len(facts))
	for _, fact := range facts {
		rules = append(rules, PolicyRule{
			APIGroups:       append([]string(nil), fact.APIGroups...),
			Resources:       append([]string(nil), fact.Resources...),
			ResourceNames:   append([]string(nil), fact.ResourceNames...),
			Verbs:           append([]string(nil), fact.Verbs...),
			NonResourceURLs: append([]string(nil), fact.NonResourceURLs...),
		})
	}
	return rules
}

// SubjectsFromFacts converts shared subject facts into the DTO sub-type.
func SubjectsFromFacts(facts []resourcemodel.SubjectFacts) []Subject {
	if len(facts) == 0 {
		return nil
	}
	subjects := make([]Subject, 0, len(facts))
	for _, fact := range facts {
		subjects = append(subjects, Subject{
			Kind:      fact.Kind,
			APIGroup:  fact.APIGroup,
			Name:      fact.Name,
			Namespace: fact.Namespace,
		})
	}
	return subjects
}

// RoleRefFromResourceLink projects a roleRef resource link into the DTO sub-type.
func RoleRefFromResourceLink(link resourcemodel.ResourceLink) RoleRef {
	if link.Ref != nil {
		return RoleRef{
			APIGroup: link.Ref.Group,
			Kind:     link.Ref.Kind,
			Name:     link.Ref.Name,
		}
	}
	if link.Display != nil {
		return RoleRef{
			APIGroup: link.Display.Group,
			Kind:     link.Display.Kind,
			Name:     link.Display.Name,
		}
	}
	return RoleRef{}
}
