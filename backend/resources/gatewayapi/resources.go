package gatewayapi

import (
	"fmt"

	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/luxury-yacht/app/backend/resources/types"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	gatewayv1 "sigs.k8s.io/gateway-api/apis/v1"
)

func (s *Service) GatewayClass(name string) (*types.GatewayClassDetails, error) {
	if err := s.ensureKind("GatewayClass"); err != nil {
		return nil, err
	}
	item, err := s.deps.GatewayClient.GatewayV1().GatewayClasses().Get(s.deps.Context, name, metav1.GetOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to get gateway class: %w", err)
	}
	return s.buildGatewayClassDetails(item), nil
}

func (s *Service) GatewayClasses() ([]*types.GatewayClassDetails, error) {
	if err := s.ensureKind("GatewayClass"); err != nil {
		return nil, err
	}
	list, err := s.deps.GatewayClient.GatewayV1().GatewayClasses().List(s.deps.Context, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to list gateway classes: %w", err)
	}
	out := make([]*types.GatewayClassDetails, 0, len(list.Items))
	for i := range list.Items {
		out = append(out, s.buildGatewayClassDetails(&list.Items[i]))
	}
	return out, nil
}

func (s *Service) Gateway(namespace, name string) (*types.GatewayDetails, error) {
	if err := s.ensureKind("Gateway"); err != nil {
		return nil, err
	}
	item, err := s.deps.GatewayClient.GatewayV1().Gateways(namespace).Get(s.deps.Context, name, metav1.GetOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to get gateway: %w", err)
	}
	return s.buildGatewayDetails(item), nil
}

func (s *Service) Gateways(namespace string) ([]*types.GatewayDetails, error) {
	if err := s.ensureKind("Gateway"); err != nil {
		return nil, err
	}
	list, err := s.deps.GatewayClient.GatewayV1().Gateways(namespace).List(s.deps.Context, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to list gateways: %w", err)
	}
	out := make([]*types.GatewayDetails, 0, len(list.Items))
	for i := range list.Items {
		out = append(out, s.buildGatewayDetails(&list.Items[i]))
	}
	return out, nil
}

func (s *Service) HTTPRoute(namespace, name string) (*types.HTTPRouteDetails, error) {
	if err := s.ensureKind("HTTPRoute"); err != nil {
		return nil, err
	}
	item, err := s.deps.GatewayClient.GatewayV1().HTTPRoutes(namespace).Get(s.deps.Context, name, metav1.GetOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to get http route: %w", err)
	}
	detail := s.buildHTTPRouteDetails(item)
	return detail, nil
}

func (s *Service) HTTPRoutes(namespace string) ([]*types.HTTPRouteDetails, error) {
	if err := s.ensureKind("HTTPRoute"); err != nil {
		return nil, err
	}
	list, err := s.deps.GatewayClient.GatewayV1().HTTPRoutes(namespace).List(s.deps.Context, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to list http routes: %w", err)
	}
	out := make([]*types.HTTPRouteDetails, 0, len(list.Items))
	for i := range list.Items {
		out = append(out, s.buildHTTPRouteDetails(&list.Items[i]))
	}
	return out, nil
}

func (s *Service) GRPCRoute(namespace, name string) (*types.GRPCRouteDetails, error) {
	if err := s.ensureKind("GRPCRoute"); err != nil {
		return nil, err
	}
	item, err := s.deps.GatewayClient.GatewayV1().GRPCRoutes(namespace).Get(s.deps.Context, name, metav1.GetOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to get grpc route: %w", err)
	}
	detail := s.buildGRPCRouteDetails(item)
	return detail, nil
}

func (s *Service) GRPCRoutes(namespace string) ([]*types.GRPCRouteDetails, error) {
	if err := s.ensureKind("GRPCRoute"); err != nil {
		return nil, err
	}
	list, err := s.deps.GatewayClient.GatewayV1().GRPCRoutes(namespace).List(s.deps.Context, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to list grpc routes: %w", err)
	}
	out := make([]*types.GRPCRouteDetails, 0, len(list.Items))
	for i := range list.Items {
		out = append(out, s.buildGRPCRouteDetails(&list.Items[i]))
	}
	return out, nil
}

func (s *Service) TLSRoute(namespace, name string) (*types.TLSRouteDetails, error) {
	if err := s.ensureKind("TLSRoute"); err != nil {
		return nil, err
	}
	item, err := s.deps.GatewayClient.GatewayV1().TLSRoutes(namespace).Get(s.deps.Context, name, metav1.GetOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to get tls route: %w", err)
	}
	detail := s.buildTLSRouteDetails(item)
	return detail, nil
}

func (s *Service) TLSRoutes(namespace string) ([]*types.TLSRouteDetails, error) {
	if err := s.ensureKind("TLSRoute"); err != nil {
		return nil, err
	}
	list, err := s.deps.GatewayClient.GatewayV1().TLSRoutes(namespace).List(s.deps.Context, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to list tls routes: %w", err)
	}
	out := make([]*types.TLSRouteDetails, 0, len(list.Items))
	for i := range list.Items {
		out = append(out, s.buildTLSRouteDetails(&list.Items[i]))
	}
	return out, nil
}

func (s *Service) ListenerSet(namespace, name string) (*types.ListenerSetDetails, error) {
	if err := s.ensureKind("ListenerSet"); err != nil {
		return nil, err
	}
	item, err := s.deps.GatewayClient.GatewayV1().ListenerSets(namespace).Get(s.deps.Context, name, metav1.GetOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to get listener set: %w", err)
	}
	return s.buildListenerSetDetails(item), nil
}

func (s *Service) ListenerSets(namespace string) ([]*types.ListenerSetDetails, error) {
	if err := s.ensureKind("ListenerSet"); err != nil {
		return nil, err
	}
	list, err := s.deps.GatewayClient.GatewayV1().ListenerSets(namespace).List(s.deps.Context, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to list listener sets: %w", err)
	}
	out := make([]*types.ListenerSetDetails, 0, len(list.Items))
	for i := range list.Items {
		out = append(out, s.buildListenerSetDetails(&list.Items[i]))
	}
	return out, nil
}

func (s *Service) ReferenceGrant(namespace, name string) (*types.ReferenceGrantDetails, error) {
	if err := s.ensureKind("ReferenceGrant"); err != nil {
		return nil, err
	}
	item, err := s.deps.GatewayClient.GatewayV1().ReferenceGrants(namespace).Get(s.deps.Context, name, metav1.GetOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to get reference grant: %w", err)
	}
	return s.buildReferenceGrantDetails(item), nil
}

func (s *Service) ReferenceGrants(namespace string) ([]*types.ReferenceGrantDetails, error) {
	if err := s.ensureKind("ReferenceGrant"); err != nil {
		return nil, err
	}
	list, err := s.deps.GatewayClient.GatewayV1().ReferenceGrants(namespace).List(s.deps.Context, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to list reference grants: %w", err)
	}
	out := make([]*types.ReferenceGrantDetails, 0, len(list.Items))
	for i := range list.Items {
		out = append(out, s.buildReferenceGrantDetails(&list.Items[i]))
	}
	return out, nil
}

func (s *Service) BackendTLSPolicy(namespace, name string) (*types.BackendTLSPolicyDetails, error) {
	if err := s.ensureKind("BackendTLSPolicy"); err != nil {
		return nil, err
	}
	item, err := s.deps.GatewayClient.GatewayV1().BackendTLSPolicies(namespace).Get(s.deps.Context, name, metav1.GetOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to get backend tls policy: %w", err)
	}
	return s.buildBackendTLSPolicyDetails(item), nil
}

func (s *Service) BackendTLSPolicies(namespace string) ([]*types.BackendTLSPolicyDetails, error) {
	if err := s.ensureKind("BackendTLSPolicy"); err != nil {
		return nil, err
	}
	list, err := s.deps.GatewayClient.GatewayV1().BackendTLSPolicies(namespace).List(s.deps.Context, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to list backend tls policies: %w", err)
	}
	out := make([]*types.BackendTLSPolicyDetails, 0, len(list.Items))
	for i := range list.Items {
		out = append(out, s.buildBackendTLSPolicyDetails(&list.Items[i]))
	}
	return out, nil
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
