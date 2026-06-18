package gateway

import (
	"testing"

	"github.com/stretchr/testify/require"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	gatewayv1 "sigs.k8s.io/gateway-api/apis/v1"
)

func TestBuildResourceModelFactsStatusAndLinks(t *testing.T) {
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

	model := BuildResourceModel("cluster-a", gateway)
	require.Equal(t, "Gateway", model.Ref.Kind)
	require.Equal(t, "gateways", model.Ref.Resource)
	require.Equal(t, "False", model.Status.State)
	require.Equal(t, "Ready: ListenersNotReady", model.Status.Label)
	require.Equal(t, "warning", model.Status.Presentation)

	facts := BuildFacts("cluster-a", gateway)
	require.Equal(t, []string{"203.0.113.10"}, facts.Addresses)
	require.Equal(t, "GatewayClass", facts.Class.Ref.Kind)
	require.Equal(t, "public", facts.Class.Ref.Name)
	require.Equal(t, "https", facts.Listeners[0].Name)
	require.Equal(t, "web.example.com", facts.Listeners[0].Hostname)
	require.Equal(t, int32(443), facts.Listeners[0].Port)
	require.Equal(t, "HTTPS", facts.Listeners[0].Protocol)
	require.Equal(t, int32(2), facts.Listeners[0].AttachedRoutes)
}
