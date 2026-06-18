package httproute

import (
	"testing"

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
	require.Equal(t, []string{"Path /api"}, facts.Rules[0].Matches)
	require.Equal(t, "Service", facts.Backends[0].Ref.Kind)
	require.Equal(t, "v1", facts.Backends[0].Ref.Version)
	require.Equal(t, "default", facts.Backends[0].Ref.Namespace)
	require.Equal(t, "api", facts.Backends[0].Ref.Name)
}
