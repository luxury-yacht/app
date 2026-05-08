package resourcemodel

import (
	"fmt"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	gatewayv1 "sigs.k8s.io/gateway-api/apis/v1"
)

func BuildHTTPRouteResourceModel(clusterID string, route *gatewayv1.HTTPRoute) ResourceModel {
	facts := BuildHTTPRouteFacts(clusterID, route)
	status := BuildGatewayRouteStatusPresentation(route.ObjectMeta, facts.RouteCommonFacts)
	return gatewayAPIResourceModel(clusterID, "HTTPRoute", "httproutes", ResourceScopeNamespaced, route.ObjectMeta, status, ResourceFacts{HTTPRoute: &facts})
}

func BuildHTTPRouteFacts(clusterID string, route *gatewayv1.HTTPRoute) HTTPRouteFacts {
	common := gatewayRouteCommonFacts(clusterID, route.ObjectMeta, route.Spec.Hostnames, route.Spec.ParentRefs, route.Status.Parents)
	for _, rule := range route.Spec.Rules {
		ruleFacts := RouteRuleFacts{}
		for _, match := range rule.Matches {
			ruleFacts.Matches = append(ruleFacts.Matches, gatewayHTTPMatchSummary(match))
		}
		for _, backendRef := range rule.BackendRefs {
			link := gatewayBackendRefLink(clusterID, route.Namespace, backendRef.BackendObjectReference)
			ruleFacts.Backends = append(ruleFacts.Backends, link)
			common.Backends = append(common.Backends, link)
		}
		common.Rules = append(common.Rules, ruleFacts)
	}
	return HTTPRouteFacts{RouteCommonFacts: common}
}

func BuildGRPCRouteResourceModel(clusterID string, route *gatewayv1.GRPCRoute) ResourceModel {
	facts := BuildGRPCRouteFacts(clusterID, route)
	status := BuildGatewayRouteStatusPresentation(route.ObjectMeta, facts.RouteCommonFacts)
	return gatewayAPIResourceModel(clusterID, "GRPCRoute", "grpcroutes", ResourceScopeNamespaced, route.ObjectMeta, status, ResourceFacts{GRPCRoute: &facts})
}

func BuildGRPCRouteFacts(clusterID string, route *gatewayv1.GRPCRoute) GRPCRouteFacts {
	common := gatewayRouteCommonFacts(clusterID, route.ObjectMeta, route.Spec.Hostnames, route.Spec.ParentRefs, route.Status.Parents)
	for _, rule := range route.Spec.Rules {
		ruleFacts := RouteRuleFacts{}
		for _, match := range rule.Matches {
			ruleFacts.Matches = append(ruleFacts.Matches, gatewayGRPCMatchSummary(match))
		}
		for _, backendRef := range rule.BackendRefs {
			link := gatewayBackendRefLink(clusterID, route.Namespace, backendRef.BackendObjectReference)
			ruleFacts.Backends = append(ruleFacts.Backends, link)
			common.Backends = append(common.Backends, link)
		}
		common.Rules = append(common.Rules, ruleFacts)
	}
	return GRPCRouteFacts{RouteCommonFacts: common}
}

func BuildTLSRouteResourceModel(clusterID string, route *gatewayv1.TLSRoute) ResourceModel {
	facts := BuildTLSRouteFacts(clusterID, route)
	status := BuildGatewayRouteStatusPresentation(route.ObjectMeta, facts.RouteCommonFacts)
	return gatewayAPIResourceModel(clusterID, "TLSRoute", "tlsroutes", ResourceScopeNamespaced, route.ObjectMeta, status, ResourceFacts{TLSRoute: &facts})
}

func BuildTLSRouteFacts(clusterID string, route *gatewayv1.TLSRoute) TLSRouteFacts {
	common := gatewayRouteCommonFacts(clusterID, route.ObjectMeta, route.Spec.Hostnames, route.Spec.ParentRefs, route.Status.Parents)
	for _, rule := range route.Spec.Rules {
		ruleFacts := RouteRuleFacts{}
		for _, backendRef := range rule.BackendRefs {
			link := gatewayBackendRefLink(clusterID, route.Namespace, backendRef.BackendObjectReference)
			ruleFacts.Backends = append(ruleFacts.Backends, link)
			common.Backends = append(common.Backends, link)
		}
		common.Rules = append(common.Rules, ruleFacts)
	}
	return TLSRouteFacts{RouteCommonFacts: common}
}

func BuildGatewayRouteStatusPresentation(meta metav1.ObjectMeta, facts RouteCommonFacts) ResourceStatusPresentation {
	state := gatewayCountState(len(facts.Rules))
	label := gatewayRouteLabel(len(facts.Rules), len(facts.ParentRefs), len(facts.Backends))
	return gatewayStatusFromConditions(meta, state, label, facts.Conditions)
}

func gatewayRouteCommonFacts(
	clusterID string,
	meta metav1.ObjectMeta,
	hostnames []gatewayv1.Hostname,
	parentRefs []gatewayv1.ParentReference,
	parentStatuses []gatewayv1.RouteParentStatus,
) RouteCommonFacts {
	conditions := gatewayConditionFacts(gatewayRouteStatusConditions(parentStatuses))
	facts := RouteCommonFacts{
		Conditions: conditions,
		Summary:    gatewayConditionsSummary(conditions),
	}
	for _, hostname := range hostnames {
		facts.Hostnames = append(facts.Hostnames, string(hostname))
	}
	for _, parentRef := range parentRefs {
		facts.ParentRefs = append(facts.ParentRefs, gatewayParentRefLink(clusterID, meta.Namespace, parentRef))
	}
	return facts
}

func gatewayRouteLabel(ruleCount, parentCount, backendCount int) string {
	return fmt.Sprintf("%d rule(s), %d parent(s), %d backend(s)", ruleCount, parentCount, backendCount)
}

func gatewayHTTPMatchSummary(match gatewayv1.HTTPRouteMatch) string {
	if match.Path != nil && match.Path.Value != nil {
		return fmt.Sprintf("Path %s", *match.Path.Value)
	}
	if match.Method != nil {
		return fmt.Sprintf("Method %s", *match.Method)
	}
	return "Any"
}

func gatewayGRPCMatchSummary(match gatewayv1.GRPCRouteMatch) string {
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
