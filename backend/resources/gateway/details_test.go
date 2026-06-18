package gateway

import (
	"testing"

	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/stretchr/testify/require"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	gatewayv1 "sigs.k8s.io/gateway-api/apis/v1"
)

func TestBuildDetailsUseSharedFacts(t *testing.T) {
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

	detail := service.buildDetails(gateway)
	require.Equal(t, "Gateway", detail.Kind)
	require.Equal(t, "cluster-a", detail.GatewayClassRef.ClusterID)
	require.Equal(t, "gateway.networking.k8s.io", detail.GatewayClassRef.Group)
	require.Equal(t, "v1", detail.GatewayClassRef.Version)
	require.Equal(t, "GatewayClass", detail.GatewayClassRef.Kind)
	require.Equal(t, "public", detail.GatewayClassRef.Name)
	require.Equal(t, []string{"203.0.113.10"}, detail.Addresses)
	require.Equal(t, "https", detail.Listeners[0].Name)
	require.Equal(t, int32(1), detail.Listeners[0].AttachedRoutes)
	require.NotNil(t, detail.Summary.Ready)
	require.Equal(t, "True", detail.Summary.Ready.Status)
}
