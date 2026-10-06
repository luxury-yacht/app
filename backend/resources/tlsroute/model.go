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
	return resourcemodel.KubernetesResourceModel(clusterID, Identity, route.ObjectMeta, status)
}

// BuildFacts projects a TLSRoute into its semantic facts.
func BuildFacts(clusterID string, route *gatewayv1.TLSRoute) Facts {
	common := resourcemodel.GatewayRouteCommonFacts(clusterID, route.ObjectMeta, route.Spec.Hostnames, route.Spec.ParentRefs, route.Status.Parents)
	for _, rule := range route.Spec.Rules {
		ruleFacts := resourcemodel.RouteRuleFacts{}
		for _, backendRef := range rule.BackendRefs {
			backend := resourcemodel.GatewayRouteBackendFacts(clusterID, route.Namespace, backendRef)
			ruleFacts.Backends = append(ruleFacts.Backends, backend)
			common.Backends = append(common.Backends, backend.Link)
		}
		common.Rules = append(common.Rules, ruleFacts)
	}
	return Facts{RouteCommonFacts: common}
}
