/*
 * backend/resources/httproute/model.go
 *
 * HTTPRoute resource model + facts. Shared route assembly (common facts, status
 * presentation) lives in resourcemodel; the HTTP match summary is HTTPRoute-only.
 */

package httproute

import (
	"fmt"

	"github.com/luxury-yacht/app/backend/resourcemodel"
	gatewayv1 "sigs.k8s.io/gateway-api/apis/v1"
)

// BuildResourceModel builds the shared resource model for an HTTPRoute.
func BuildResourceModel(clusterID string, route *gatewayv1.HTTPRoute) resourcemodel.ResourceModel {
	facts := BuildFacts(clusterID, route)
	status := resourcemodel.BuildGatewayRouteStatusPresentation(route.ObjectMeta, facts.RouteCommonFacts)
	return resourcemodel.GatewayAPIResourceModel(clusterID, "HTTPRoute", "httproutes", resourcemodel.ResourceScopeNamespaced, route.ObjectMeta, status, resourcemodel.ResourceFacts{})
}

// BuildFacts projects an HTTPRoute into its semantic facts.
func BuildFacts(clusterID string, route *gatewayv1.HTTPRoute) Facts {
	common := resourcemodel.GatewayRouteCommonFacts(clusterID, route.ObjectMeta, route.Spec.Hostnames, route.Spec.ParentRefs, route.Status.Parents)
	for _, rule := range route.Spec.Rules {
		ruleFacts := resourcemodel.RouteRuleFacts{}
		for _, match := range rule.Matches {
			ruleFacts.Matches = append(ruleFacts.Matches, httpMatchSummary(match))
		}
		for _, backendRef := range rule.BackendRefs {
			link := resourcemodel.GatewayBackendRefLink(clusterID, route.Namespace, backendRef.BackendObjectReference)
			ruleFacts.Backends = append(ruleFacts.Backends, link)
			common.Backends = append(common.Backends, link)
		}
		common.Rules = append(common.Rules, ruleFacts)
	}
	return Facts{RouteCommonFacts: common}
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
