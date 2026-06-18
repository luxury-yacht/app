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
	return ObjectRefFromResourceRef(*link.Ref)
}

// ConditionStatesFromFacts projects condition facts into the wire condition list.
func ConditionStatesFromFacts(facts []resourcemodel.ConditionFacts) []ConditionState {
	if len(facts) == 0 {
		return nil
	}
	states := make([]ConditionState, 0, len(facts))
	for _, condition := range facts {
		state := ConditionState{
			Type:    condition.Type,
			Status:  condition.Status,
			Reason:  condition.Reason,
			Message: condition.Message,
		}
		if !condition.LastTransitionTime.IsZero() {
			state.LastTransitionTime = condition.LastTransitionTime.Time.Format("2006-01-02 15:04:05")
		}
		states = append(states, state)
	}
	return states
}

// ConditionStatePointerFromFacts projects an optional condition fact pointer.
func ConditionStatePointerFromFacts(facts *resourcemodel.ConditionFacts) *ConditionState {
	if facts == nil {
		return nil
	}
	state := ConditionState{
		Type:    facts.Type,
		Status:  facts.Status,
		Reason:  facts.Reason,
		Message: facts.Message,
	}
	if !facts.LastTransitionTime.IsZero() {
		state.LastTransitionTime = facts.LastTransitionTime.Time.Format("2006-01-02 15:04:05")
	}
	return &state
}

// ConditionsSummaryFromFacts projects the Accepted/Programmed/Ready/Resolved summary.
func ConditionsSummaryFromFacts(facts resourcemodel.ConditionsSummaryFacts) ConditionsSummary {
	return ConditionsSummary{
		Accepted:   ConditionStatePointerFromFacts(facts.Accepted),
		Programmed: ConditionStatePointerFromFacts(facts.Programmed),
		Ready:      ConditionStatePointerFromFacts(facts.Ready),
		Resolved:   ConditionStatePointerFromFacts(facts.Resolved),
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
		detail.Rules = append(detail.Rules, RouteRuleDetails{
			Matches:     append([]string(nil), rule.Matches...),
			BackendRefs: RefOrDisplaySliceFromResourceLinks(rule.Backends),
		})
	}
	return detail
}
