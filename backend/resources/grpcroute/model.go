/*
 * backend/resources/grpcroute/model.go
 *
 * GRPCRoute resource model + facts. Shared route assembly lives in resourcemodel;
 * the GRPC match summary is GRPCRoute-only.
 */

package grpcroute

import (
	"github.com/luxury-yacht/app/backend/resourcemodel"
	gatewayv1 "sigs.k8s.io/gateway-api/apis/v1"
)

// BuildResourceModel builds the shared resource model for a GRPCRoute.
func BuildResourceModel(clusterID string, route *gatewayv1.GRPCRoute) resourcemodel.ResourceModel {
	facts := BuildFacts(clusterID, route)
	status := resourcemodel.BuildGatewayRouteStatusPresentation(route.ObjectMeta, facts.RouteCommonFacts)
	return resourcemodel.KubernetesResourceModel(clusterID, Identity, route.ObjectMeta, status)
}

// BuildFacts projects a GRPCRoute into its semantic facts.
func BuildFacts(clusterID string, route *gatewayv1.GRPCRoute) Facts {
	common := resourcemodel.GatewayRouteCommonFacts(clusterID, route.ObjectMeta, route.Spec.Hostnames, route.Spec.ParentRefs, route.Status.Parents)
	for _, rule := range route.Spec.Rules {
		ruleFacts := resourcemodel.RouteRuleFacts{}
		for _, match := range rule.Matches {
			ruleFacts.Matches = append(ruleFacts.Matches, grpcMatchFacts(match))
		}
		for _, backendRef := range rule.BackendRefs {
			backend := resourcemodel.GatewayRouteBackendFacts(clusterID, route.Namespace, backendRef.BackendRef)
			ruleFacts.Backends = append(ruleFacts.Backends, backend)
			common.Backends = append(common.Backends, backend.Link)
		}
		common.Rules = append(common.Rules, ruleFacts)
	}
	return Facts{RouteCommonFacts: common}
}

// grpcMatchFacts keeps every condition of a gRPC match; a missing method matches every call and a
// missing comparison type is the API default, Exact.
func grpcMatchFacts(match gatewayv1.GRPCRouteMatch) resourcemodel.RouteMatchFacts {
	facts := resourcemodel.RouteMatchFacts{}
	if match.Method != nil {
		method := &resourcemodel.RouteGRPCMethodFacts{Type: string(gatewayv1.GRPCMethodMatchExact)}
		if match.Method.Type != nil {
			method.Type = string(*match.Method.Type)
		}
		if match.Method.Service != nil {
			method.Service = *match.Method.Service
		}
		if match.Method.Method != nil {
			method.Method = *match.Method.Method
		}
		facts.GRPCMethod = method
	}
	for _, header := range match.Headers {
		next := resourcemodel.RouteNamedMatchFacts{Type: string(gatewayv1.GRPCHeaderMatchExact), Name: string(header.Name), Value: header.Value}
		if header.Type != nil {
			next.Type = string(*header.Type)
		}
		facts.Headers = append(facts.Headers, next)
	}
	return facts
}
