/*
 * backend/resources/grpcroute/model.go
 *
 * GRPCRoute resource model + facts. Shared route assembly lives in resourcemodel;
 * the GRPC match summary is GRPCRoute-only.
 */

package grpcroute

import (
	"fmt"

	"github.com/luxury-yacht/app/backend/resourcemodel"
	gatewayv1 "sigs.k8s.io/gateway-api/apis/v1"
)

// BuildResourceModel builds the shared resource model for a GRPCRoute.
func BuildResourceModel(clusterID string, route *gatewayv1.GRPCRoute) resourcemodel.ResourceModel {
	facts := BuildFacts(clusterID, route)
	status := resourcemodel.BuildGatewayRouteStatusPresentation(route.ObjectMeta, facts.RouteCommonFacts)
	return resourcemodel.GatewayAPIResourceModel(clusterID, "GRPCRoute", "grpcroutes", resourcemodel.ResourceScopeNamespaced, route.ObjectMeta, status, resourcemodel.ResourceFacts{})
}

// BuildFacts projects a GRPCRoute into its semantic facts.
func BuildFacts(clusterID string, route *gatewayv1.GRPCRoute) Facts {
	common := resourcemodel.GatewayRouteCommonFacts(clusterID, route.ObjectMeta, route.Spec.Hostnames, route.Spec.ParentRefs, route.Status.Parents)
	for _, rule := range route.Spec.Rules {
		ruleFacts := resourcemodel.RouteRuleFacts{}
		for _, match := range rule.Matches {
			ruleFacts.Matches = append(ruleFacts.Matches, grpcMatchSummary(match))
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
