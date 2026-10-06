/*
 * backend/resources/httproute/model.go
 *
 * HTTPRoute resource model + facts. Shared route assembly (common facts, status
 * presentation) lives in resourcemodel; the HTTP match projection is HTTPRoute-only.
 */

package httproute

import (
	"github.com/luxury-yacht/app/backend/resourcemodel"
	gatewayv1 "sigs.k8s.io/gateway-api/apis/v1"
)

// BuildResourceModel builds the shared resource model for an HTTPRoute.
func BuildResourceModel(clusterID string, route *gatewayv1.HTTPRoute) resourcemodel.ResourceModel {
	facts := BuildFacts(clusterID, route)
	status := resourcemodel.BuildGatewayRouteStatusPresentation(route.ObjectMeta, facts.RouteCommonFacts)
	return resourcemodel.KubernetesResourceModel(clusterID, Identity, route.ObjectMeta, status)
}

// BuildFacts projects an HTTPRoute into its semantic facts.
func BuildFacts(clusterID string, route *gatewayv1.HTTPRoute) Facts {
	common := resourcemodel.GatewayRouteCommonFacts(clusterID, route.ObjectMeta, route.Spec.Hostnames, route.Spec.ParentRefs, route.Status.Parents)
	for _, rule := range route.Spec.Rules {
		ruleFacts := resourcemodel.RouteRuleFacts{}
		for _, match := range rule.Matches {
			ruleFacts.Matches = append(ruleFacts.Matches, httpMatchFacts(match))
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

// httpMatchFacts keeps every condition of an HTTP match, applying the API defaults: a missing path
// is PathPrefix "/" (every path) and a missing comparison type is Exact (PathPrefix for paths).
func httpMatchFacts(match gatewayv1.HTTPRouteMatch) resourcemodel.RouteMatchFacts {
	facts := resourcemodel.RouteMatchFacts{
		Path: &resourcemodel.RouteValueMatchFacts{Type: string(gatewayv1.PathMatchPathPrefix), Value: "/"},
	}
	if match.Path != nil {
		if match.Path.Type != nil {
			facts.Path.Type = string(*match.Path.Type)
		}
		if match.Path.Value != nil {
			facts.Path.Value = *match.Path.Value
		}
	}
	if match.Method != nil {
		facts.Method = string(*match.Method)
	}
	for _, header := range match.Headers {
		facts.Headers = append(facts.Headers, namedMatch(header.Type, string(header.Name), header.Value))
	}
	for _, param := range match.QueryParams {
		facts.QueryParams = append(facts.QueryParams, namedMatch(param.Type, string(param.Name), param.Value))
	}
	return facts
}

func namedMatch[T ~string](matchType *T, name, value string) resourcemodel.RouteNamedMatchFacts {
	facts := resourcemodel.RouteNamedMatchFacts{Type: "Exact", Name: name, Value: value}
	if matchType != nil {
		facts.Type = string(*matchType)
	}
	return facts
}
