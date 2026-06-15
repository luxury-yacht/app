package gatewayapi

import (
	"fmt"

	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/luxury-yacht/app/backend/resources/types"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	gatewayv1 "sigs.k8s.io/gateway-api/apis/v1"
)

// getGatewayResource runs the shared ensure-kind → fetch → build flow for a single
// Gateway-API object. fetch returns the typed object; build projects it to a DTO.
func getGatewayResource[T any, D any](
	s *Service,
	kind, noun string,
	fetch func() (*T, error),
	build func(*T) *D,
) (*D, error) {
	if err := s.ensureKind(kind); err != nil {
		return nil, err
	}
	item, err := fetch()
	if err != nil {
		return nil, fmt.Errorf("failed to get %s: %w", noun, err)
	}
	return build(item), nil
}

// listGatewayResources runs the shared ensure-kind → list → build flow for a
// Gateway-API kind.
func listGatewayResources[T any, D any](
	s *Service,
	kind, noun string,
	list func() ([]T, error),
	build func(*T) *D,
) ([]*D, error) {
	if err := s.ensureKind(kind); err != nil {
		return nil, err
	}
	items, err := list()
	if err != nil {
		return nil, fmt.Errorf("failed to list %s: %w", noun, err)
	}
	out := make([]*D, 0, len(items))
	for i := range items {
		out = append(out, build(&items[i]))
	}
	return out, nil
}

func (s *Service) GatewayClass(name string) (*types.GatewayClassDetails, error) {
	return getGatewayResource(s, "GatewayClass", "gateway class",
		func() (*gatewayv1.GatewayClass, error) {
			return s.deps.GatewayClient.GatewayV1().GatewayClasses().Get(s.deps.Context, name, metav1.GetOptions{})
		}, s.buildGatewayClassDetails)
}

func (s *Service) GatewayClasses() ([]*types.GatewayClassDetails, error) {
	return listGatewayResources(s, "GatewayClass", "gateway classes",
		func() ([]gatewayv1.GatewayClass, error) {
			list, err := s.deps.GatewayClient.GatewayV1().GatewayClasses().List(s.deps.Context, metav1.ListOptions{})
			if err != nil {
				return nil, err
			}
			return list.Items, nil
		}, s.buildGatewayClassDetails)
}

func (s *Service) Gateway(namespace, name string) (*types.GatewayDetails, error) {
	return getGatewayResource(s, "Gateway", "gateway",
		func() (*gatewayv1.Gateway, error) {
			return s.deps.GatewayClient.GatewayV1().Gateways(namespace).Get(s.deps.Context, name, metav1.GetOptions{})
		}, s.buildGatewayDetails)
}

func (s *Service) Gateways(namespace string) ([]*types.GatewayDetails, error) {
	return listGatewayResources(s, "Gateway", "gateways",
		func() ([]gatewayv1.Gateway, error) {
			list, err := s.deps.GatewayClient.GatewayV1().Gateways(namespace).List(s.deps.Context, metav1.ListOptions{})
			if err != nil {
				return nil, err
			}
			return list.Items, nil
		}, s.buildGatewayDetails)
}

func (s *Service) HTTPRoute(namespace, name string) (*types.HTTPRouteDetails, error) {
	return getGatewayResource(s, "HTTPRoute", "http route",
		func() (*gatewayv1.HTTPRoute, error) {
			return s.deps.GatewayClient.GatewayV1().HTTPRoutes(namespace).Get(s.deps.Context, name, metav1.GetOptions{})
		}, s.buildHTTPRouteDetails)
}

func (s *Service) HTTPRoutes(namespace string) ([]*types.HTTPRouteDetails, error) {
	return listGatewayResources(s, "HTTPRoute", "http routes",
		func() ([]gatewayv1.HTTPRoute, error) {
			list, err := s.deps.GatewayClient.GatewayV1().HTTPRoutes(namespace).List(s.deps.Context, metav1.ListOptions{})
			if err != nil {
				return nil, err
			}
			return list.Items, nil
		}, s.buildHTTPRouteDetails)
}

func (s *Service) GRPCRoute(namespace, name string) (*types.GRPCRouteDetails, error) {
	return getGatewayResource(s, "GRPCRoute", "grpc route",
		func() (*gatewayv1.GRPCRoute, error) {
			return s.deps.GatewayClient.GatewayV1().GRPCRoutes(namespace).Get(s.deps.Context, name, metav1.GetOptions{})
		}, s.buildGRPCRouteDetails)
}

func (s *Service) GRPCRoutes(namespace string) ([]*types.GRPCRouteDetails, error) {
	return listGatewayResources(s, "GRPCRoute", "grpc routes",
		func() ([]gatewayv1.GRPCRoute, error) {
			list, err := s.deps.GatewayClient.GatewayV1().GRPCRoutes(namespace).List(s.deps.Context, metav1.ListOptions{})
			if err != nil {
				return nil, err
			}
			return list.Items, nil
		}, s.buildGRPCRouteDetails)
}

func (s *Service) TLSRoute(namespace, name string) (*types.TLSRouteDetails, error) {
	return getGatewayResource(s, "TLSRoute", "tls route",
		func() (*gatewayv1.TLSRoute, error) {
			return s.deps.GatewayClient.GatewayV1().TLSRoutes(namespace).Get(s.deps.Context, name, metav1.GetOptions{})
		}, s.buildTLSRouteDetails)
}

func (s *Service) TLSRoutes(namespace string) ([]*types.TLSRouteDetails, error) {
	return listGatewayResources(s, "TLSRoute", "tls routes",
		func() ([]gatewayv1.TLSRoute, error) {
			list, err := s.deps.GatewayClient.GatewayV1().TLSRoutes(namespace).List(s.deps.Context, metav1.ListOptions{})
			if err != nil {
				return nil, err
			}
			return list.Items, nil
		}, s.buildTLSRouteDetails)
}

func (s *Service) ListenerSet(namespace, name string) (*types.ListenerSetDetails, error) {
	return getGatewayResource(s, "ListenerSet", "listener set",
		func() (*gatewayv1.ListenerSet, error) {
			return s.deps.GatewayClient.GatewayV1().ListenerSets(namespace).Get(s.deps.Context, name, metav1.GetOptions{})
		}, s.buildListenerSetDetails)
}

func (s *Service) ListenerSets(namespace string) ([]*types.ListenerSetDetails, error) {
	return listGatewayResources(s, "ListenerSet", "listener sets",
		func() ([]gatewayv1.ListenerSet, error) {
			list, err := s.deps.GatewayClient.GatewayV1().ListenerSets(namespace).List(s.deps.Context, metav1.ListOptions{})
			if err != nil {
				return nil, err
			}
			return list.Items, nil
		}, s.buildListenerSetDetails)
}

func (s *Service) ReferenceGrant(namespace, name string) (*types.ReferenceGrantDetails, error) {
	return getGatewayResource(s, "ReferenceGrant", "reference grant",
		func() (*gatewayv1.ReferenceGrant, error) {
			return s.deps.GatewayClient.GatewayV1().ReferenceGrants(namespace).Get(s.deps.Context, name, metav1.GetOptions{})
		}, s.buildReferenceGrantDetails)
}

func (s *Service) ReferenceGrants(namespace string) ([]*types.ReferenceGrantDetails, error) {
	return listGatewayResources(s, "ReferenceGrant", "reference grants",
		func() ([]gatewayv1.ReferenceGrant, error) {
			list, err := s.deps.GatewayClient.GatewayV1().ReferenceGrants(namespace).List(s.deps.Context, metav1.ListOptions{})
			if err != nil {
				return nil, err
			}
			return list.Items, nil
		}, s.buildReferenceGrantDetails)
}

func (s *Service) BackendTLSPolicy(namespace, name string) (*types.BackendTLSPolicyDetails, error) {
	return getGatewayResource(s, "BackendTLSPolicy", "backend tls policy",
		func() (*gatewayv1.BackendTLSPolicy, error) {
			return s.deps.GatewayClient.GatewayV1().BackendTLSPolicies(namespace).Get(s.deps.Context, name, metav1.GetOptions{})
		}, s.buildBackendTLSPolicyDetails)
}

func (s *Service) BackendTLSPolicies(namespace string) ([]*types.BackendTLSPolicyDetails, error) {
	return listGatewayResources(s, "BackendTLSPolicy", "backend tls policies",
		func() ([]gatewayv1.BackendTLSPolicy, error) {
			list, err := s.deps.GatewayClient.GatewayV1().BackendTLSPolicies(namespace).List(s.deps.Context, metav1.ListOptions{})
			if err != nil {
				return nil, err
			}
			return list.Items, nil
		}, s.buildBackendTLSPolicyDetails)
}

func (s *Service) buildGatewayClassDetails(item *gatewayv1.GatewayClass) *types.GatewayClassDetails {
	model := resourcemodel.BuildGatewayClassResourceModel(s.deps.ClusterID, item)
	facts := model.Facts.GatewayClass
	detail := &types.GatewayClassDetails{
		Kind:        "GatewayClass",
		Name:        item.Name,
		Controller:  facts.ControllerName,
		Age:         common.FormatAge(item.CreationTimestamp.Time),
		Conditions:  conditionStatesFromFacts(facts.Conditions),
		Summary:     conditionsSummaryFromFacts(facts.Summary),
		Labels:      item.Labels,
		Annotations: item.Annotations,
	}
	if facts.Parameters != nil {
		ref := refOrDisplayFromResourceLink(*facts.Parameters)
		detail.Parameters = &ref
	}
	detail.Details = fmt.Sprintf("Controller: %s", detail.Controller)
	return detail
}

func (s *Service) buildGatewayDetails(item *gatewayv1.Gateway) *types.GatewayDetails {
	model := resourcemodel.BuildGatewayResourceModel(s.deps.ClusterID, item)
	facts := model.Facts.Gateway
	detail := &types.GatewayDetails{
		Kind:            "Gateway",
		Name:            item.Name,
		Namespace:       item.Namespace,
		Age:             common.FormatAge(item.CreationTimestamp.Time),
		GatewayClassRef: objectRefFromResourceLink(facts.Class),
		Addresses:       append([]string(nil), facts.Addresses...),
		Listeners:       listenerDetailsFromFacts(facts.Listeners),
		Conditions:      conditionStatesFromFacts(facts.Conditions),
		Summary:         conditionsSummaryFromFacts(facts.Summary),
		Labels:          item.Labels,
		Annotations:     item.Annotations,
	}
	detail.Details = fmt.Sprintf("%d listener(s)", len(facts.Listeners))
	if len(detail.Addresses) > 0 {
		detail.Details = fmt.Sprintf("%s, %s", detail.Details, detail.Addresses[0])
	}
	return detail
}

func (s *Service) buildHTTPRouteDetails(item *gatewayv1.HTTPRoute) *types.HTTPRouteDetails {
	model := resourcemodel.BuildHTTPRouteResourceModel(s.deps.ClusterID, item)
	facts := model.Facts.HTTPRoute.RouteCommonFacts
	detail := routeDetailsFromFacts("HTTPRoute", item.ObjectMeta, facts)
	detail.Details = routeDetailsText(len(facts.Rules), len(detail.ParentRefs), len(detail.BackendRefs))
	return detail
}

func (s *Service) buildGRPCRouteDetails(item *gatewayv1.GRPCRoute) *types.GRPCRouteDetails {
	model := resourcemodel.BuildGRPCRouteResourceModel(s.deps.ClusterID, item)
	facts := model.Facts.GRPCRoute.RouteCommonFacts
	detail := routeDetailsFromFacts("GRPCRoute", item.ObjectMeta, facts)
	detail.Details = routeDetailsText(len(facts.Rules), len(detail.ParentRefs), len(detail.BackendRefs))
	return detail
}

func (s *Service) buildTLSRouteDetails(item *gatewayv1.TLSRoute) *types.TLSRouteDetails {
	model := resourcemodel.BuildTLSRouteResourceModel(s.deps.ClusterID, item)
	facts := model.Facts.TLSRoute.RouteCommonFacts
	detail := routeDetailsFromFacts("TLSRoute", item.ObjectMeta, facts)
	detail.Details = routeDetailsText(len(facts.Rules), len(detail.ParentRefs), len(detail.BackendRefs))
	return detail
}

func (s *Service) buildListenerSetDetails(item *gatewayv1.ListenerSet) *types.ListenerSetDetails {
	model := resourcemodel.BuildListenerSetResourceModel(s.deps.ClusterID, item)
	facts := model.Facts.ListenerSet
	return &types.ListenerSetDetails{
		Kind:        "ListenerSet",
		Name:        item.Name,
		Namespace:   item.Namespace,
		Age:         common.FormatAge(item.CreationTimestamp.Time),
		Details:     fmt.Sprintf("%d listener(s)", len(facts.Listeners)),
		ParentRef:   refOrDisplayFromResourceLink(facts.ParentRef),
		Listeners:   listenerDetailsFromFacts(facts.Listeners),
		Conditions:  conditionStatesFromFacts(facts.Conditions),
		Summary:     conditionsSummaryFromFacts(facts.Summary),
		Labels:      item.Labels,
		Annotations: item.Annotations,
	}
}

func (s *Service) buildReferenceGrantDetails(item *gatewayv1.ReferenceGrant) *types.ReferenceGrantDetails {
	model := resourcemodel.BuildReferenceGrantResourceModel(s.deps.ClusterID, item)
	facts := model.Facts.ReferenceGrant
	detail := &types.ReferenceGrantDetails{
		Kind:        "ReferenceGrant",
		Name:        item.Name,
		Namespace:   item.Namespace,
		Age:         common.FormatAge(item.CreationTimestamp.Time),
		Labels:      item.Labels,
		Annotations: item.Annotations,
	}
	for _, from := range facts.From {
		detail.From = append(detail.From, types.ReferenceGrantFromInfo{
			Group:     from.Group,
			Kind:      from.Kind,
			Namespace: from.Namespace,
		})
	}
	for _, to := range facts.To {
		detail.To = append(detail.To, refOrDisplayFromResourceLink(to))
	}
	detail.Details = fmt.Sprintf("%d from, %d to", len(detail.From), len(detail.To))
	return detail
}

func (s *Service) buildBackendTLSPolicyDetails(item *gatewayv1.BackendTLSPolicy) *types.BackendTLSPolicyDetails {
	model := resourcemodel.BuildBackendTLSPolicyResourceModel(s.deps.ClusterID, item)
	facts := model.Facts.BackendTLSPolicy
	detail := &types.BackendTLSPolicyDetails{
		Kind:        "BackendTLSPolicy",
		Name:        item.Name,
		Namespace:   item.Namespace,
		Age:         common.FormatAge(item.CreationTimestamp.Time),
		Conditions:  conditionStatesFromFacts(facts.Conditions),
		Summary:     conditionsSummaryFromFacts(facts.Summary),
		Labels:      item.Labels,
		Annotations: item.Annotations,
	}
	for _, targetRef := range facts.TargetRefs {
		detail.TargetRefs = append(detail.TargetRefs, refOrDisplayFromResourceLink(targetRef))
	}
	detail.Details = fmt.Sprintf("%d target(s)", len(detail.TargetRefs))
	return detail
}

func routeDetailsText(rules, parents, backends int) string {
	return fmt.Sprintf("%d rule(s), %d parent(s), %d backend(s)", rules, parents, backends)
}

func routeDetailsFromFacts(kind string, meta metav1.ObjectMeta, facts resourcemodel.RouteCommonFacts) *types.RouteDetails {
	detail := &types.RouteDetails{
		Kind:        kind,
		Name:        meta.Name,
		Namespace:   meta.Namespace,
		Age:         common.FormatAge(meta.CreationTimestamp.Time),
		Hostnames:   append([]string(nil), facts.Hostnames...),
		ParentRefs:  resourceLinksToRefOrDisplay(facts.ParentRefs),
		BackendRefs: resourceLinksToRefOrDisplay(facts.Backends),
		Conditions:  conditionStatesFromFacts(facts.Conditions),
		Summary:     conditionsSummaryFromFacts(facts.Summary),
		Labels:      meta.Labels,
		Annotations: meta.Annotations,
	}
	for _, rule := range facts.Rules {
		detail.Rules = append(detail.Rules, types.RouteRuleDetails{
			Matches:     append([]string(nil), rule.Matches...),
			BackendRefs: resourceLinksToRefOrDisplay(rule.Backends),
		})
	}
	return detail
}

func listenerDetailsFromFacts(facts []resourcemodel.GatewayListenerFacts) []types.GatewayListenerDetails {
	if len(facts) == 0 {
		return nil
	}
	details := make([]types.GatewayListenerDetails, 0, len(facts))
	for _, listener := range facts {
		details = append(details, types.GatewayListenerDetails{
			Name:           listener.Name,
			Hostname:       listener.Hostname,
			Port:           listener.Port,
			Protocol:       listener.Protocol,
			AttachedRoutes: listener.AttachedRoutes,
			Conditions:     conditionStatesFromFacts(listener.Conditions),
		})
	}
	return details
}

func resourceLinksToRefOrDisplay(links []resourcemodel.ResourceLink) []types.RefOrDisplay {
	return types.RefOrDisplaySliceFromResourceLinks(links)
}

func refOrDisplayFromResourceLink(link resourcemodel.ResourceLink) types.RefOrDisplay {
	return types.RefOrDisplayFromResourceLink(link)
}

func objectRefFromResourceLink(link *resourcemodel.ResourceLink) types.ObjectRef {
	if link == nil || link.Ref == nil {
		return types.ObjectRef{}
	}
	return types.ObjectRefFromResourceRef(*link.Ref)
}

func conditionStatesFromFacts(facts []resourcemodel.ConditionFacts) []types.ConditionState {
	if len(facts) == 0 {
		return nil
	}
	states := make([]types.ConditionState, 0, len(facts))
	for _, condition := range facts {
		state := types.ConditionState{
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

func conditionsSummaryFromFacts(facts resourcemodel.ConditionsSummaryFacts) types.ConditionsSummary {
	return types.ConditionsSummary{
		Accepted:   conditionStatePointerFromFacts(facts.Accepted),
		Programmed: conditionStatePointerFromFacts(facts.Programmed),
		Ready:      conditionStatePointerFromFacts(facts.Ready),
		Resolved:   conditionStatePointerFromFacts(facts.Resolved),
	}
}

func conditionStatePointerFromFacts(facts *resourcemodel.ConditionFacts) *types.ConditionState {
	if facts == nil {
		return nil
	}
	state := types.ConditionState{
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
