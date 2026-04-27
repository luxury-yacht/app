package gatewayapi

import (
	"fmt"

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
	detail := &types.GatewayClassDetails{
		Kind:        "GatewayClass",
		Name:        item.Name,
		Controller:  string(item.Spec.ControllerName),
		Age:         common.FormatAge(item.CreationTimestamp.Time),
		Conditions:  conditionStates(item.Status.Conditions),
		Summary:     summarizeConditions(item.Status.Conditions),
		Labels:      item.Labels,
		Annotations: item.Annotations,
	}
	if item.Spec.ParametersRef != nil {
		detail.Parameters = &types.RefOrDisplay{Display: &types.DisplayRef{
			ClusterID: s.deps.ClusterID,
			Group:     string(item.Spec.ParametersRef.Group),
			Kind:      string(item.Spec.ParametersRef.Kind),
			Namespace: stringValue(item.Spec.ParametersRef.Namespace),
			Name:      string(item.Spec.ParametersRef.Name),
		}}
	}
	detail.Details = fmt.Sprintf("Controller: %s", detail.Controller)
	return detail
}

func (s *Service) buildGatewayDetails(item *gatewayv1.Gateway) *types.GatewayDetails {
	conditions := conditionStates(item.Status.Conditions)
	detail := &types.GatewayDetails{
		Kind:            "Gateway",
		Name:            item.Name,
		Namespace:       item.Namespace,
		Age:             common.FormatAge(item.CreationTimestamp.Time),
		GatewayClassRef: gatewayClassRef(s.deps, item.Spec.GatewayClassName),
		Listeners:       s.gatewayListeners(item.Spec.Listeners, item.Status.Listeners),
		Conditions:      conditions,
		Summary:         summarizeConditions(item.Status.Conditions),
		Labels:          item.Labels,
		Annotations:     item.Annotations,
	}
	for _, address := range item.Status.Addresses {
		detail.Addresses = append(detail.Addresses, string(address.Value))
	}
	detail.Details = fmt.Sprintf("%d listener(s)", len(item.Spec.Listeners))
	if len(detail.Addresses) > 0 {
		detail.Details = fmt.Sprintf("%s, %s", detail.Details, detail.Addresses[0])
	}
	return detail
}

func (s *Service) buildHTTPRouteDetails(item *gatewayv1.HTTPRoute) *types.HTTPRouteDetails {
	detail := s.routeBase("HTTPRoute", item.ObjectMeta, item.Spec.Hostnames, item.Spec.ParentRefs, item.Status.Parents)
	for _, rule := range item.Spec.Rules {
		ruleDetail := types.RouteRuleDetails{}
		for _, match := range rule.Matches {
			ruleDetail.Matches = append(ruleDetail.Matches, httpMatchSummary(match))
		}
		for _, backendRef := range rule.BackendRefs {
			ref := backendObjectReferenceRef(s.deps, item.Namespace, backendRef.BackendObjectReference)
			ruleDetail.BackendRefs = append(ruleDetail.BackendRefs, ref)
			detail.BackendRefs = append(detail.BackendRefs, ref)
		}
		detail.Rules = append(detail.Rules, ruleDetail)
	}
	detail.Details = routeDetailsText(len(item.Spec.Rules), len(detail.ParentRefs), len(detail.BackendRefs))
	return detail
}

func (s *Service) buildGRPCRouteDetails(item *gatewayv1.GRPCRoute) *types.GRPCRouteDetails {
	detail := s.routeBase("GRPCRoute", item.ObjectMeta, item.Spec.Hostnames, item.Spec.ParentRefs, item.Status.Parents)
	for _, rule := range item.Spec.Rules {
		ruleDetail := types.RouteRuleDetails{}
		for _, match := range rule.Matches {
			ruleDetail.Matches = append(ruleDetail.Matches, grpcMatchSummary(match))
		}
		for _, backendRef := range rule.BackendRefs {
			ref := backendObjectReferenceRef(s.deps, item.Namespace, backendRef.BackendObjectReference)
			ruleDetail.BackendRefs = append(ruleDetail.BackendRefs, ref)
			detail.BackendRefs = append(detail.BackendRefs, ref)
		}
		detail.Rules = append(detail.Rules, ruleDetail)
	}
	detail.Details = routeDetailsText(len(item.Spec.Rules), len(detail.ParentRefs), len(detail.BackendRefs))
	return detail
}

func (s *Service) buildTLSRouteDetails(item *gatewayv1.TLSRoute) *types.TLSRouteDetails {
	detail := s.routeBase("TLSRoute", item.ObjectMeta, item.Spec.Hostnames, item.Spec.ParentRefs, item.Status.Parents)
	for _, rule := range item.Spec.Rules {
		ruleDetail := types.RouteRuleDetails{}
		for _, backendRef := range rule.BackendRefs {
			ref := backendObjectReferenceRef(s.deps, item.Namespace, backendRef.BackendObjectReference)
			ruleDetail.BackendRefs = append(ruleDetail.BackendRefs, ref)
			detail.BackendRefs = append(detail.BackendRefs, ref)
		}
		detail.Rules = append(detail.Rules, ruleDetail)
	}
	detail.Details = routeDetailsText(len(item.Spec.Rules), len(detail.ParentRefs), len(detail.BackendRefs))
	return detail
}

func (s *Service) routeBase(
	kind string,
	meta metav1.ObjectMeta,
	hostnames []gatewayv1.Hostname,
	parentRefs []gatewayv1.ParentReference,
	parentStatuses []gatewayv1.RouteParentStatus,
) *types.RouteDetails {
	var conditions []metav1.Condition
	for _, status := range parentStatuses {
		conditions = append(conditions, status.Conditions...)
	}
	detail := &types.RouteDetails{
		Kind:        kind,
		Name:        meta.Name,
		Namespace:   meta.Namespace,
		Age:         common.FormatAge(meta.CreationTimestamp.Time),
		Conditions:  conditionStates(conditions),
		Summary:     summarizeConditions(conditions),
		Labels:      meta.Labels,
		Annotations: meta.Annotations,
	}
	for _, hostname := range hostnames {
		detail.Hostnames = append(detail.Hostnames, string(hostname))
	}
	for _, parentRef := range parentRefs {
		detail.ParentRefs = append(detail.ParentRefs, parentReferenceRef(s.deps, meta.Namespace, parentRef))
	}
	return detail
}

func (s *Service) buildListenerSetDetails(item *gatewayv1.ListenerSet) *types.ListenerSetDetails {
	return &types.ListenerSetDetails{
		Kind:        "ListenerSet",
		Name:        item.Name,
		Namespace:   item.Namespace,
		Age:         common.FormatAge(item.CreationTimestamp.Time),
		Details:     fmt.Sprintf("%d listener(s)", len(item.Spec.Listeners)),
		ParentRef:   parentGatewayReferenceRef(s.deps, item.Namespace, item.Spec.ParentRef),
		Listeners:   listenerEntryDetails(item.Spec.Listeners, item.Status.Listeners),
		Conditions:  conditionStates(item.Status.Conditions),
		Summary:     summarizeConditions(item.Status.Conditions),
		Labels:      item.Labels,
		Annotations: item.Annotations,
	}
}

func (s *Service) buildReferenceGrantDetails(item *gatewayv1.ReferenceGrant) *types.ReferenceGrantDetails {
	detail := &types.ReferenceGrantDetails{
		Kind:        "ReferenceGrant",
		Name:        item.Name,
		Namespace:   item.Namespace,
		Age:         common.FormatAge(item.CreationTimestamp.Time),
		Labels:      item.Labels,
		Annotations: item.Annotations,
	}
	for _, from := range item.Spec.From {
		detail.From = append(detail.From, types.ReferenceGrantFromInfo{
			Group:     string(from.Group),
			Kind:      string(from.Kind),
			Namespace: string(from.Namespace),
		})
	}
	for _, to := range item.Spec.To {
		detail.To = append(detail.To, referenceGrantToRef(s.deps, item.Namespace, to))
	}
	detail.Details = fmt.Sprintf("%d from, %d to", len(detail.From), len(detail.To))
	return detail
}

func (s *Service) buildBackendTLSPolicyDetails(item *gatewayv1.BackendTLSPolicy) *types.BackendTLSPolicyDetails {
	var conditions []metav1.Condition
	for _, ancestor := range item.Status.Ancestors {
		conditions = append(conditions, ancestor.Conditions...)
	}
	detail := &types.BackendTLSPolicyDetails{
		Kind:        "BackendTLSPolicy",
		Name:        item.Name,
		Namespace:   item.Namespace,
		Age:         common.FormatAge(item.CreationTimestamp.Time),
		Conditions:  conditionStates(conditions),
		Summary:     summarizeConditions(conditions),
		Labels:      item.Labels,
		Annotations: item.Annotations,
	}
	for _, targetRef := range item.Spec.TargetRefs {
		detail.TargetRefs = append(detail.TargetRefs, policyTargetReferenceRef(s.deps, item.Namespace, targetRef))
	}
	detail.Details = fmt.Sprintf("%d target(s)", len(detail.TargetRefs))
	return detail
}

func (s *Service) gatewayListeners(spec []gatewayv1.Listener, status []gatewayv1.ListenerStatus) []types.GatewayListenerDetails {
	statusByName := map[string]gatewayv1.ListenerStatus{}
	for _, listenerStatus := range status {
		statusByName[string(listenerStatus.Name)] = listenerStatus
	}
	out := make([]types.GatewayListenerDetails, 0, len(spec))
	for _, listener := range spec {
		detail := types.GatewayListenerDetails{
			Name:     string(listener.Name),
			Port:     int32(listener.Port),
			Protocol: string(listener.Protocol),
		}
		if listener.Hostname != nil {
			detail.Hostname = string(*listener.Hostname)
		}
		if status, ok := statusByName[string(listener.Name)]; ok {
			detail.AttachedRoutes = int32(status.AttachedRoutes)
			detail.Conditions = conditionStates(status.Conditions)
		}
		out = append(out, detail)
	}
	return out
}

func listenerEntryDetails(spec []gatewayv1.ListenerEntry, status []gatewayv1.ListenerEntryStatus) []types.GatewayListenerDetails {
	statusByName := map[string]gatewayv1.ListenerEntryStatus{}
	for _, listenerStatus := range status {
		statusByName[string(listenerStatus.Name)] = listenerStatus
	}
	out := make([]types.GatewayListenerDetails, 0, len(spec))
	for _, listener := range spec {
		detail := types.GatewayListenerDetails{
			Name:     string(listener.Name),
			Port:     int32(listener.Port),
			Protocol: string(listener.Protocol),
		}
		if listener.Hostname != nil {
			detail.Hostname = string(*listener.Hostname)
		}
		if status, ok := statusByName[string(listener.Name)]; ok {
			detail.AttachedRoutes = int32(status.AttachedRoutes)
			detail.Conditions = conditionStates(status.Conditions)
		}
		out = append(out, detail)
	}
	return out
}

func routeDetailsText(rules, parents, backends int) string {
	return fmt.Sprintf("%d rule(s), %d parent(s), %d backend(s)", rules, parents, backends)
}

func httpMatchSummary(match gatewayv1.HTTPRouteMatch) string {
	if match.Path != nil && match.Path.Value != nil {
		return fmt.Sprintf("Path %s", *match.Path.Value)
	}
	if match.Method != nil {
		return fmt.Sprintf("Method %s", *match.Method)
	}
	return "Any"
}

func grpcMatchSummary(match gatewayv1.GRPCRouteMatch) string {
	if match.Method != nil {
		if match.Method.Service != nil && match.Method.Method != nil {
			return fmt.Sprintf("%s/%s", *match.Method.Service, *match.Method.Method)
		}
		if match.Method.Service != nil {
			return *match.Method.Service
		}
		if match.Method.Method != nil {
			return *match.Method.Method
		}
	}
	return "Any"
}

func stringValue(value *gatewayv1.Namespace) string {
	if value == nil {
		return ""
	}
	return string(*value)
}
