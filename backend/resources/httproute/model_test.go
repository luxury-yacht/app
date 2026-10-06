package httproute

import (
	"testing"

	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/stretchr/testify/require"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	gatewayv1 "sigs.k8s.io/gateway-api/apis/v1"
)

func TestBuildResourceModelFactsStatusAndLinks(t *testing.T) {
	path := "/api"
	serviceGroup := gatewayv1.Group("")
	serviceKind := gatewayv1.Kind("Service")
	parentNamespace := gatewayv1.Namespace("edge")
	route := &gatewayv1.HTTPRoute{
		ObjectMeta: metav1.ObjectMeta{Name: "api", Namespace: "default", UID: types.UID("route-uid")},
		Spec: gatewayv1.HTTPRouteSpec{
			CommonRouteSpec: gatewayv1.CommonRouteSpec{
				ParentRefs: []gatewayv1.ParentReference{{
					Namespace: &parentNamespace,
					Name:      gatewayv1.ObjectName("edge"),
				}},
			},
			Hostnames: []gatewayv1.Hostname{"api.example.com"},
			Rules: []gatewayv1.HTTPRouteRule{{
				Matches: []gatewayv1.HTTPRouteMatch{{
					Path: &gatewayv1.HTTPPathMatch{Value: &path},
				}},
				BackendRefs: []gatewayv1.HTTPBackendRef{{
					BackendRef: gatewayv1.BackendRef{
						BackendObjectReference: gatewayv1.BackendObjectReference{
							Group: &serviceGroup,
							Kind:  &serviceKind,
							Name:  gatewayv1.ObjectName("api"),
						},
					},
				}},
			}},
		},
		Status: gatewayv1.HTTPRouteStatus{
			RouteStatus: gatewayv1.RouteStatus{Parents: []gatewayv1.RouteParentStatus{{
				ParentRef: gatewayv1.ParentReference{Name: gatewayv1.ObjectName("edge")},
				Conditions: []metav1.Condition{{
					Type:   "Accepted",
					Status: metav1.ConditionFalse,
					Reason: "NoMatchingListener",
				}},
			}}},
		},
	}

	model := BuildResourceModel("cluster-a", route)
	require.Equal(t, "HTTPRoute", model.Ref.Kind)
	require.Equal(t, "httproutes", model.Ref.Resource)
	require.Equal(t, "False", model.Status.State)
	require.Equal(t, "Accepted: NoMatchingListener", model.Status.Label)
	require.Equal(t, "warning", model.Status.Presentation)

	facts := BuildFacts("cluster-a", route)
	require.Equal(t, []string{"api.example.com"}, facts.Hostnames)
	require.Equal(t, "Gateway", facts.ParentRefs[0].Ref.Kind)
	require.Equal(t, "edge", facts.ParentRefs[0].Ref.Namespace)
	require.Equal(t, "edge", facts.ParentRefs[0].Ref.Name)
	require.Equal(t, []resourcemodel.RouteMatchFacts{{Path: &resourcemodel.RouteValueMatchFacts{Type: "PathPrefix", Value: "/api"}}}, facts.Rules[0].Matches)
	require.Equal(t, "Service", facts.Backends[0].Ref.Kind)
	require.Equal(t, "v1", facts.Backends[0].Ref.Version)
	require.Equal(t, "default", facts.Backends[0].Ref.Namespace)
	require.Equal(t, "api", facts.Backends[0].Ref.Name)
}

// Every condition in a match must hold, so each one is kept; backend port and weight show where
// matched traffic goes and how it is split.
func TestBuildFactsKeepMatchConditionsAndBackendTraffic(t *testing.T) {
	exact := gatewayv1.PathMatchExact
	path := "/v1/api"
	get := gatewayv1.HTTPMethodGet
	regex := gatewayv1.HeaderMatchRegularExpression
	port := gatewayv1.PortNumber(8080)
	weight := int32(90)
	route := &gatewayv1.HTTPRoute{
		ObjectMeta: metav1.ObjectMeta{Name: "api", Namespace: "shop"},
		Spec: gatewayv1.HTTPRouteSpec{Rules: []gatewayv1.HTTPRouteRule{{
			Matches: []gatewayv1.HTTPRouteMatch{
				{
					Path:   &gatewayv1.HTTPPathMatch{Type: &exact, Value: &path},
					Method: &get,
					Headers: []gatewayv1.HTTPHeaderMatch{
						{Name: "x-canary", Value: "true"},
						{Type: &regex, Name: "x-tenant", Value: "acme-.*"},
					},
					QueryParams: []gatewayv1.HTTPQueryParamMatch{{Name: "v", Value: "2"}},
				},
				{Headers: []gatewayv1.HTTPHeaderMatch{{Name: "x-debug", Value: "1"}}},
			},
			BackendRefs: []gatewayv1.HTTPBackendRef{
				{BackendRef: gatewayv1.BackendRef{
					BackendObjectReference: gatewayv1.BackendObjectReference{Name: "api-v1", Port: &port},
					Weight:                 &weight,
				}},
				{BackendRef: gatewayv1.BackendRef{BackendObjectReference: gatewayv1.BackendObjectReference{Name: "api-v2"}}},
			},
		}}},
	}

	rule := BuildFacts("cluster-a", route).Rules[0]
	require.Equal(t, []resourcemodel.RouteMatchFacts{
		{
			Path:   &resourcemodel.RouteValueMatchFacts{Type: "Exact", Value: "/v1/api"},
			Method: "GET",
			Headers: []resourcemodel.RouteNamedMatchFacts{
				{Type: "Exact", Name: "x-canary", Value: "true"},
				{Type: "RegularExpression", Name: "x-tenant", Value: "acme-.*"},
			},
			QueryParams: []resourcemodel.RouteNamedMatchFacts{{Type: "Exact", Name: "v", Value: "2"}},
		},
		// A match without a path matches every path (the API's PathPrefix "/" default).
		{
			Path:    &resourcemodel.RouteValueMatchFacts{Type: "PathPrefix", Value: "/"},
			Headers: []resourcemodel.RouteNamedMatchFacts{{Type: "Exact", Name: "x-debug", Value: "1"}},
		},
	}, rule.Matches)
	require.Len(t, rule.Backends, 2)
	require.Equal(t, "api-v1", rule.Backends[0].Link.Ref.Name)
	require.Equal(t, int32(8080), *rule.Backends[0].Port)
	require.Equal(t, int32(90), rule.Backends[0].Weight)
	// An unset weight is the API default of 1; an unset port stays unset.
	require.Nil(t, rule.Backends[1].Port)
	require.Equal(t, int32(1), rule.Backends[1].Weight)
}
