/*
 * backend/resources/tlsroute/model.go
 *
 * TLSRoute resource model + facts. Shared route assembly lives in resourcemodel;
 * TLSRoute has no per-rule match summary (it routes by SNI hostname).
 */

package tlsroute

import (
	"github.com/luxury-yacht/app/backend/resourcemodel"
	gatewayv1 "sigs.k8s.io/gateway-api/apis/v1"
)

// BuildResourceModel builds the shared resource model for a TLSRoute.
func BuildResourceModel(clusterID string, route *gatewayv1.TLSRoute) resourcemodel.ResourceModel {
	facts := BuildFacts(clusterID, route)
	status := resourcemodel.BuildGatewayRouteStatusPresentation(route.ObjectMeta, facts.RouteCommonFacts)
	return resourcemodel.GatewayAPIResourceModel(clusterID, "TLSRoute", "tlsroutes", resourcemodel.ResourceScopeNamespaced, route.ObjectMeta, status, resourcemodel.ResourceFacts{})
}

// BuildFacts projects a TLSRoute into its semantic facts.
func BuildFacts(clusterID string, route *gatewayv1.TLSRoute) Facts {
	common := resourcemodel.GatewayRouteCommonFacts(clusterID, route.ObjectMeta, route.Spec.Hostnames, route.Spec.ParentRefs, route.Status.Parents)
	for _, rule := range route.Spec.Rules {
		ruleFacts := resourcemodel.RouteRuleFacts{}
		for _, backendRef := range rule.BackendRefs {
			link := resourcemodel.GatewayBackendRefLink(clusterID, route.Namespace, backendRef.BackendObjectReference)
			ruleFacts.Backends = append(ruleFacts.Backends, link)
			common.Backends = append(common.Backends, link)
		}
		common.Rules = append(common.Rules, ruleFacts)
	}
	return Facts{RouteCommonFacts: common}
}
