package gatewayapi

import (
	"testing"

	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/stretchr/testify/require"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	gatewayv1 "sigs.k8s.io/gateway-api/apis/v1"
)

func TestBuildGatewayAPIDetailsUseSharedFacts(t *testing.T) {
	service := NewService(common.Dependencies{ClusterID: "cluster-a"})
	hostname := gatewayv1.Hostname("web.example.com")
	gateway := &gatewayv1.Gateway{
		ObjectMeta: metav1.ObjectMeta{Name: "edge", Namespace: "default"},
		Spec: gatewayv1.GatewaySpec{
			GatewayClassName: gatewayv1.ObjectName("public"),
			Listeners: []gatewayv1.Listener{{
				Name:     gatewayv1.SectionName("https"),
				Hostname: &hostname,
				Port:     gatewayv1.PortNumber(443),
				Protocol: gatewayv1.HTTPSProtocolType,
			}},
		},
		Status: gatewayv1.GatewayStatus{
			Addresses: []gatewayv1.GatewayStatusAddress{{Value: "203.0.113.10"}},
			Conditions: []metav1.Condition{{
				Type:   "Ready",
				Status: metav1.ConditionTrue,
				Reason: "Ready",
			}},
			Listeners: []gatewayv1.ListenerStatus{{
				Name:           gatewayv1.SectionName("https"),
				AttachedRoutes: 1,
			}},
		},
	}

	detail := service.buildGatewayDetails(gateway)
	require.Equal(t, "Gateway", detail.Kind)
	require.Equal(t, "cluster-a", detail.GatewayClassRef.ClusterID)
	require.Equal(t, Group, detail.GatewayClassRef.Group)
	require.Equal(t, "v1", detail.GatewayClassRef.Version)
	require.Equal(t, "GatewayClass", detail.GatewayClassRef.Kind)
	require.Equal(t, "public", detail.GatewayClassRef.Name)
	require.Equal(t, []string{"203.0.113.10"}, detail.Addresses)
	require.Equal(t, "https", detail.Listeners[0].Name)
	require.Equal(t, int32(1), detail.Listeners[0].AttachedRoutes)
	require.NotNil(t, detail.Summary.Ready)
	require.Equal(t, "True", detail.Summary.Ready.Status)
}

func TestBuildRouteDetailsUseSharedFactsAndDisplayOnlyRefs(t *testing.T) {
	service := NewService(common.Dependencies{ClusterID: "cluster-a"})
	customGroup := gatewayv1.Group("example.com")
	customKind := gatewayv1.Kind("Widget")
	route := &gatewayv1.HTTPRoute{
		ObjectMeta: metav1.ObjectMeta{Name: "api", Namespace: "default"},
		Spec: gatewayv1.HTTPRouteSpec{
			CommonRouteSpec: gatewayv1.CommonRouteSpec{
				ParentRefs: []gatewayv1.ParentReference{{Name: gatewayv1.ObjectName("edge")}},
			},
			Rules: []gatewayv1.HTTPRouteRule{{
				BackendRefs: []gatewayv1.HTTPBackendRef{{
					BackendRef: gatewayv1.BackendRef{
						BackendObjectReference: gatewayv1.BackendObjectReference{
							Group: &customGroup,
							Kind:  &customKind,
							Name:  gatewayv1.ObjectName("backend"),
						},
					},
				}},
			}},
		},
	}

	detail := service.buildHTTPRouteDetails(route)
	require.Equal(t, "HTTPRoute", detail.Kind)
	require.NotNil(t, detail.ParentRefs[0].Ref)
	require.Equal(t, "Gateway", detail.ParentRefs[0].Ref.Kind)
	require.Equal(t, "default", detail.ParentRefs[0].Ref.Namespace)
	require.NotNil(t, detail.BackendRefs[0].Display)
	require.Nil(t, detail.BackendRefs[0].Ref)
	require.Equal(t, "example.com", detail.BackendRefs[0].Display.Group)
	require.Equal(t, "Widget", detail.BackendRefs[0].Display.Kind)
	require.Equal(t, "backend", detail.BackendRefs[0].Display.Name)
	require.NotNil(t, detail.Rules[0].BackendRefs[0].Display)
}

func TestBuildGatewayClassDetailsUsesSharedParameterLink(t *testing.T) {
	service := NewService(common.Dependencies{ClusterID: "cluster-a"})
	namespace := gatewayv1.Namespace("platform")
	gatewayClass := &gatewayv1.GatewayClass{
		ObjectMeta: metav1.ObjectMeta{Name: "public"},
		Spec: gatewayv1.GatewayClassSpec{
			ControllerName: "example.com/controller",
			ParametersRef: &gatewayv1.ParametersReference{
				Group:     gatewayv1.Group(""),
				Kind:      gatewayv1.Kind("ConfigMap"),
				Name:      "params",
				Namespace: &namespace,
			},
		},
	}

	detail := service.buildGatewayClassDetails(gatewayClass)
	require.Equal(t, "example.com/controller", detail.Controller)
	require.NotNil(t, detail.Parameters.Ref)
	require.Equal(t, "v1", detail.Parameters.Ref.Version)
	require.Equal(t, "ConfigMap", detail.Parameters.Ref.Kind)
	require.Equal(t, "platform", detail.Parameters.Ref.Namespace)
	require.Equal(t, "params", detail.Parameters.Ref.Name)
}
