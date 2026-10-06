package tlsroute

import (
	"testing"

	"github.com/stretchr/testify/require"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	gatewayv1 "sigs.k8s.io/gateway-api/apis/v1"
)

// TLS route rules have no match conditions; their backends keep port and weight, and an explicit
// weight of 0 (no traffic) stays distinct from the default of 1.
func TestBuildFactsKeepBackendTraffic(t *testing.T) {
	port := gatewayv1.PortNumber(5432)
	zero := int32(0)
	route := &gatewayv1.TLSRoute{
		ObjectMeta: metav1.ObjectMeta{Name: "db", Namespace: "data"},
		Spec: gatewayv1.TLSRouteSpec{Rules: []gatewayv1.TLSRouteRule{{BackendRefs: []gatewayv1.BackendRef{
			{BackendObjectReference: gatewayv1.BackendObjectReference{Name: "postgres", Port: &port}},
			{BackendObjectReference: gatewayv1.BackendObjectReference{Name: "standby"}, Weight: &zero},
		}}}},
	}

	rule := BuildFacts("cluster-a", route).Rules[0]
	require.Empty(t, rule.Matches)
	require.Equal(t, int32(5432), *rule.Backends[0].Port)
	require.Equal(t, int32(1), rule.Backends[0].Weight)
	require.Equal(t, "standby", rule.Backends[1].Link.Ref.Name)
	require.Equal(t, int32(0), rule.Backends[1].Weight)
}
