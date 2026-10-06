package grpcroute

import (
	"testing"

	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/stretchr/testify/require"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	gatewayv1 "sigs.k8s.io/gateway-api/apis/v1"
)

// gRPC matches keep the full method selector and header conditions; a match without a method
// matches every method.
func TestBuildFactsKeepGRPCMatchConditionsAndBackendTraffic(t *testing.T) {
	service := "orders.OrderService"
	method := "Create"
	port := gatewayv1.PortNumber(9090)
	route := &gatewayv1.GRPCRoute{
		ObjectMeta: metav1.ObjectMeta{Name: "orders", Namespace: "shop"},
		Spec: gatewayv1.GRPCRouteSpec{Rules: []gatewayv1.GRPCRouteRule{{
			Matches: []gatewayv1.GRPCRouteMatch{
				{
					Method:  &gatewayv1.GRPCMethodMatch{Service: &service, Method: &method},
					Headers: []gatewayv1.GRPCHeaderMatch{{Name: "tenant", Value: "acme"}},
				},
				{Headers: []gatewayv1.GRPCHeaderMatch{{Name: "x-debug", Value: "1"}}},
			},
			BackendRefs: []gatewayv1.GRPCBackendRef{{BackendRef: gatewayv1.BackendRef{
				BackendObjectReference: gatewayv1.BackendObjectReference{Name: "orders", Port: &port},
			}}},
		}}},
	}

	rule := BuildFacts("cluster-a", route).Rules[0]
	require.Equal(t, []resourcemodel.RouteMatchFacts{
		{
			GRPCMethod: &resourcemodel.RouteGRPCMethodFacts{Type: "Exact", Service: "orders.OrderService", Method: "Create"},
			Headers:    []resourcemodel.RouteNamedMatchFacts{{Type: "Exact", Name: "tenant", Value: "acme"}},
		},
		{Headers: []resourcemodel.RouteNamedMatchFacts{{Type: "Exact", Name: "x-debug", Value: "1"}}},
	}, rule.Matches)
	require.Equal(t, "orders", rule.Backends[0].Link.Ref.Name)
	require.Equal(t, int32(9090), *rule.Backends[0].Port)
	require.Equal(t, int32(1), rule.Backends[0].Weight)
}
