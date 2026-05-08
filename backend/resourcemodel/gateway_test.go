package resourcemodel

import (
	"testing"

	"github.com/stretchr/testify/require"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	gatewayv1 "sigs.k8s.io/gateway-api/apis/v1"
)

func TestBuildGatewayClassResourceModelFactsStatusAndDisplayParameter(t *testing.T) {
	namespace := gatewayv1.Namespace("platform")
	gatewayClass := &gatewayv1.GatewayClass{
		ObjectMeta: metav1.ObjectMeta{Name: "public", UID: types.UID("gatewayclass-uid")},
		Spec: gatewayv1.GatewayClassSpec{
			ControllerName: "example.com/gateway-controller",
			ParametersRef: &gatewayv1.ParametersReference{
				Group:     gatewayv1.Group("example.com"),
				Kind:      gatewayv1.Kind("GatewayParameters"),
				Name:      "public",
				Namespace: &namespace,
			},
		},
		Status: gatewayv1.GatewayClassStatus{
			Conditions: []metav1.Condition{{Type: "Accepted", Status: metav1.ConditionTrue, Reason: "Accepted"}},
		},
	}

	model := BuildGatewayClassResourceModel("cluster-a", gatewayClass)
	require.Equal(t, "cluster-a", model.Ref.ClusterID)
	require.Equal(t, gatewayAPIGroup, model.Ref.Group)
	require.Equal(t, "v1", model.Ref.Version)
	require.Equal(t, "GatewayClass", model.Ref.Kind)
	require.Equal(t, "gatewayclasses", model.Ref.Resource)
	require.Equal(t, ResourceScopeCluster, model.Scope)
	require.Equal(t, "True", model.Status.State)
	require.Equal(t, "Accepted", model.Status.Label)
	require.Equal(t, "ready", model.Status.Presentation)
	require.Equal(t, "example.com/gateway-controller", model.Facts.GatewayClass.ControllerName)
	require.NotNil(t, model.Facts.GatewayClass.Summary.Accepted)
	require.NotNil(t, model.Facts.GatewayClass.Parameters.Display)
	require.Nil(t, model.Facts.GatewayClass.Parameters.Ref)
	require.Equal(t, "example.com", model.Facts.GatewayClass.Parameters.Display.Group)
	require.Equal(t, "GatewayParameters", model.Facts.GatewayClass.Parameters.Display.Kind)
	require.Equal(t, "platform", model.Facts.GatewayClass.Parameters.Display.Namespace)
	require.Equal(t, "public", model.Facts.GatewayClass.Parameters.Display.Name)
}

func TestBuildGatewayResourceModelFactsStatusAndLinks(t *testing.T) {
	hostname := gatewayv1.Hostname("web.example.com")
	gateway := &gatewayv1.Gateway{
		ObjectMeta: metav1.ObjectMeta{Name: "edge", Namespace: "default", UID: types.UID("gateway-uid")},
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
				Status: metav1.ConditionFalse,
				Reason: "ListenersNotReady",
			}},
			Listeners: []gatewayv1.ListenerStatus{{
				Name:           gatewayv1.SectionName("https"),
				AttachedRoutes: 2,
				Conditions:     []metav1.Condition{{Type: "Accepted", Status: metav1.ConditionTrue}},
			}},
		},
	}

	model := BuildGatewayResourceModel("cluster-a", gateway)
	require.Equal(t, "Gateway", model.Ref.Kind)
	require.Equal(t, "gateways", model.Ref.Resource)
	require.Equal(t, "False", model.Status.State)
	require.Equal(t, "Ready: ListenersNotReady", model.Status.Label)
	require.Equal(t, "warning", model.Status.Presentation)
	require.Equal(t, []string{"203.0.113.10"}, model.Facts.Gateway.Addresses)
	require.Equal(t, "GatewayClass", model.Facts.Gateway.Class.Ref.Kind)
	require.Equal(t, "public", model.Facts.Gateway.Class.Ref.Name)
	require.Equal(t, "https", model.Facts.Gateway.Listeners[0].Name)
	require.Equal(t, "web.example.com", model.Facts.Gateway.Listeners[0].Hostname)
	require.Equal(t, int32(443), model.Facts.Gateway.Listeners[0].Port)
	require.Equal(t, "HTTPS", model.Facts.Gateway.Listeners[0].Protocol)
	require.Equal(t, int32(2), model.Facts.Gateway.Listeners[0].AttachedRoutes)
}

func TestBuildHTTPRouteResourceModelFactsStatusAndLinks(t *testing.T) {
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

	model := BuildHTTPRouteResourceModel("cluster-a", route)
	require.Equal(t, "HTTPRoute", model.Ref.Kind)
	require.Equal(t, "httproutes", model.Ref.Resource)
	require.Equal(t, "False", model.Status.State)
	require.Equal(t, "Accepted: NoMatchingListener", model.Status.Label)
	require.Equal(t, "warning", model.Status.Presentation)
	require.Equal(t, []string{"api.example.com"}, model.Facts.HTTPRoute.Hostnames)
	require.Equal(t, "Gateway", model.Facts.HTTPRoute.ParentRefs[0].Ref.Kind)
	require.Equal(t, "edge", model.Facts.HTTPRoute.ParentRefs[0].Ref.Namespace)
	require.Equal(t, "edge", model.Facts.HTTPRoute.ParentRefs[0].Ref.Name)
	require.Equal(t, []string{"Path /api"}, model.Facts.HTTPRoute.Rules[0].Matches)
	require.Equal(t, "Service", model.Facts.HTTPRoute.Backends[0].Ref.Kind)
	require.Equal(t, "v1", model.Facts.HTTPRoute.Backends[0].Ref.Version)
	require.Equal(t, "default", model.Facts.HTTPRoute.Backends[0].Ref.Namespace)
	require.Equal(t, "api", model.Facts.HTTPRoute.Backends[0].Ref.Name)
}

func TestBuildGatewayPolicyResourceModelFactsAndDisplayLinks(t *testing.T) {
	parentName := gatewayv1.ObjectName("edge")
	listenerSet := &gatewayv1.ListenerSet{
		ObjectMeta: metav1.ObjectMeta{Name: "extra", Namespace: "default"},
		Spec: gatewayv1.ListenerSetSpec{
			ParentRef: gatewayv1.ParentGatewayReference{Name: parentName},
			Listeners: []gatewayv1.ListenerEntry{{
				Name:     gatewayv1.SectionName("http"),
				Port:     gatewayv1.PortNumber(80),
				Protocol: gatewayv1.HTTPProtocolType,
			}},
		},
		Status: gatewayv1.ListenerSetStatus{
			Conditions: []metav1.Condition{{Type: "Accepted", Status: metav1.ConditionTrue}},
		},
	}
	listenerSetModel := BuildListenerSetResourceModel("cluster-a", listenerSet)
	require.Equal(t, "ListenerSet", listenerSetModel.Ref.Kind)
	require.Equal(t, "True", listenerSetModel.Status.State)
	require.Equal(t, "Gateway", listenerSetModel.Facts.ListenerSet.ParentRef.Ref.Kind)
	require.Equal(t, "edge", listenerSetModel.Facts.ListenerSet.ParentRef.Ref.Name)

	customGroup := gatewayv1.Group("example.com")
	customKind := gatewayv1.Kind("Widget")
	grant := &gatewayv1.ReferenceGrant{
		ObjectMeta: metav1.ObjectMeta{Name: "allow-widgets", Namespace: "default"},
		Spec: gatewayv1.ReferenceGrantSpec{
			From: []gatewayv1.ReferenceGrantFrom{{Group: gatewayv1.Group("gateway.networking.k8s.io"), Kind: gatewayv1.Kind("HTTPRoute"), Namespace: gatewayv1.Namespace("apps")}},
			To:   []gatewayv1.ReferenceGrantTo{{Group: customGroup, Kind: customKind}},
		},
	}
	grantModel := BuildReferenceGrantResourceModel("cluster-a", grant)
	require.Equal(t, "1", grantModel.Status.State)
	require.Equal(t, "1 from, 1 to", grantModel.Status.Label)
	require.Equal(t, "apps", grantModel.Facts.ReferenceGrant.From[0].Namespace)
	require.NotNil(t, grantModel.Facts.ReferenceGrant.To[0].Display)
	require.Nil(t, grantModel.Facts.ReferenceGrant.To[0].Ref)
	require.Equal(t, "Widget", grantModel.Facts.ReferenceGrant.To[0].Display.Kind)

	targetGroup := gatewayv1.Group("")
	policy := &gatewayv1.BackendTLSPolicy{
		ObjectMeta: metav1.ObjectMeta{Name: "tls", Namespace: "default"},
		Spec: gatewayv1.BackendTLSPolicySpec{
			TargetRefs: []gatewayv1.LocalPolicyTargetReferenceWithSectionName{{
				LocalPolicyTargetReference: gatewayv1.LocalPolicyTargetReference{
					Group: targetGroup,
					Kind:  gatewayv1.Kind("Service"),
					Name:  gatewayv1.ObjectName("api"),
				},
			}},
		},
		Status: gatewayv1.PolicyStatus{Ancestors: []gatewayv1.PolicyAncestorStatus{{
			Conditions: []metav1.Condition{{Type: "Accepted", Status: metav1.ConditionTrue}},
		}}},
	}
	policyModel := BuildBackendTLSPolicyResourceModel("cluster-a", policy)
	require.Equal(t, "True", policyModel.Status.State)
	require.Equal(t, "Service", policyModel.Facts.BackendTLSPolicy.TargetRefs[0].Ref.Kind)
	require.Equal(t, "default", policyModel.Facts.BackendTLSPolicy.TargetRefs[0].Ref.Namespace)
	require.Equal(t, "api", policyModel.Facts.BackendTLSPolicy.TargetRefs[0].Ref.Name)
}
