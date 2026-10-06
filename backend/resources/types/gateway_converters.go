package types

import (
	"fmt"

	"github.com/luxury-yacht/app/backend/internal/timeutil"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// Gateway API detail projections shared by every Gateway-API kind package. The
// kinds split into their own packages but share these route/condition/listener
// DTO shapes, so the facts→DTO converters live here next to the DTO types.

// ObjectRefFromResourceLink projects a resource link pointer into an object ref,
// returning the zero value when the link or its ref is absent.
func ObjectRefFromResourceLink(link *resourcemodel.ResourceLink) ObjectRef {
	if link == nil || link.Ref == nil {
		return ObjectRef{}
	}
	return *link.Ref
}

// ConditionStatesFromFacts projects condition facts into the wire condition list.
func ConditionStatesFromFacts(facts []resourcemodel.ConditionFacts) []ConditionState {
	if len(facts) == 0 {
		return nil
	}
	states := make([]ConditionState, 0, len(facts))
	for _, condition := range facts {
		states = append(states, conditionStateFromFacts(condition))
	}
	return states
}

// conditionStatePointerFromFacts projects an optional condition fact pointer.
func conditionStatePointerFromFacts(facts *resourcemodel.ConditionFacts) *ConditionState {
	if facts == nil {
		return nil
	}
	state := conditionStateFromFacts(*facts)
	return &state
}

func conditionStateFromFacts(facts resourcemodel.ConditionFacts) ConditionState {
	state := ConditionState{
		Type:    facts.Type,
		Status:  facts.Status,
		Reason:  facts.Reason,
		Message: facts.Message,
	}
	if !facts.LastTransitionTime.IsZero() {
		state.LastTransitionTime = facts.LastTransitionTime.Time.Format("2006-01-02 15:04:05")
	}
	return state
}

// ConditionsSummaryFromFacts projects the Accepted/Programmed/Ready/Resolved summary.
func ConditionsSummaryFromFacts(facts resourcemodel.ConditionsSummaryFacts) ConditionsSummary {
	return ConditionsSummary{
		Accepted:   conditionStatePointerFromFacts(facts.Accepted),
		Programmed: conditionStatePointerFromFacts(facts.Programmed),
		Ready:      conditionStatePointerFromFacts(facts.Ready),
		Resolved:   conditionStatePointerFromFacts(facts.Resolved),
	}
}

// GatewayListenerDetailsFromFacts projects listener facts into wire listener details.
func GatewayListenerDetailsFromFacts(facts []resourcemodel.GatewayListenerFacts) []GatewayListenerDetails {
	if len(facts) == 0 {
		return nil
	}
	details := make([]GatewayListenerDetails, 0, len(facts))
	for _, listener := range facts {
		details = append(details, GatewayListenerDetails{
			Name:           listener.Name,
			Hostname:       listener.Hostname,
			Port:           listener.Port,
			Protocol:       listener.Protocol,
			AttachedRoutes: listener.AttachedRoutes,
			Conditions:     ConditionStatesFromFacts(listener.Conditions),
		})
	}
	return details
}

// RouteDetailsText renders the shared route summary line.
func RouteDetailsText(rules, parents, backends int) string {
	return fmt.Sprintf("%d rule(s), %d parent(s), %d backend(s)", rules, parents, backends)
}

// RouteDetailsFromFacts projects the common route facts shared by HTTP/GRPC/TLS routes.
func RouteDetailsFromFacts(kind string, meta metav1.ObjectMeta, facts resourcemodel.RouteCommonFacts) *RouteDetails {
	detail := &RouteDetails{
		Kind:        kind,
		Name:        meta.Name,
		Namespace:   meta.Namespace,
		Age:         timeutil.FormatAge(meta.CreationTimestamp.Time),
		Hostnames:   append([]string(nil), facts.Hostnames...),
		ParentRefs:  RefOrDisplaySliceFromResourceLinks(facts.ParentRefs),
		BackendRefs: RefOrDisplaySliceFromResourceLinks(facts.Backends),
		Conditions:  ConditionStatesFromFacts(facts.Conditions),
		Summary:     ConditionsSummaryFromFacts(facts.Summary),
		Labels:      meta.Labels,
		Annotations: meta.Annotations,
	}
	for _, rule := range facts.Rules {
		detail.Rules = append(detail.Rules, routeRuleDetailsFromFacts(rule))
	}
	return detail
}

func routeRuleDetailsFromFacts(rule resourcemodel.RouteRuleFacts) RouteRuleDetails {
	details := RouteRuleDetails{}
	for _, match := range rule.Matches {
		details.Matches = append(details.Matches, routeMatchDetailsFromFacts(match))
	}
	for _, backend := range rule.Backends {
		details.BackendRefs = append(details.BackendRefs, RouteBackendRefDetails{
			Target: RefOrDisplayFromResourceLink(backend.Link),
			Port:   backend.Port,
			Weight: backend.Weight,
		})
	}
	return details
}

func routeMatchDetailsFromFacts(match resourcemodel.RouteMatchFacts) RouteMatchDetails {
	details := RouteMatchDetails{
		Method:      match.Method,
		Headers:     routeNamedMatchesFromFacts(match.Headers),
		QueryParams: routeNamedMatchesFromFacts(match.QueryParams),
	}
	if match.Path != nil {
		details.Path = &RouteValueMatch{Type: match.Path.Type, Value: match.Path.Value}
	}
	if match.GRPCMethod != nil {
		details.GRPCMethod = &RouteGRPCMethod{
			Type:    match.GRPCMethod.Type,
			Service: match.GRPCMethod.Service,
			Method:  match.GRPCMethod.Method,
		}
	}
	return details
}

func routeNamedMatchesFromFacts(matches []resourcemodel.RouteNamedMatchFacts) []RouteNamedMatch {
	if len(matches) == 0 {
		return nil
	}
	details := make([]RouteNamedMatch, 0, len(matches))
	for _, match := range matches {
		details = append(details, RouteNamedMatch(match))
	}
	return details
}
