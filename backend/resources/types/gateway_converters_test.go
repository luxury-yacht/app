package types

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/stretchr/testify/require"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	gatewayv1 "sigs.k8s.io/gateway-api/apis/v1"
)

func TestRouteConditionsAndSummaryPreserveTheSameConditionEvidence(t *testing.T) {
	for _, transition := range []metav1.Time{{}, {Time: time.Date(2026, 9, 18, 12, 30, 0, 0, time.UTC)}} {
		condition := resourcemodel.ConditionFacts{Type: "Accepted", Status: "False", Reason: "NotAllowedByListeners", Message: "namespace not allowed", LastTransitionTime: transition}
		detail := RouteDetailsFromFacts("HTTPRoute", metav1.ObjectMeta{}, resourcemodel.RouteCommonFacts{
			Conditions: []resourcemodel.ConditionFacts{condition},
			Summary:    resourcemodel.ConditionsSummaryFacts{Accepted: &condition},
		})
		require.Len(t, detail.Conditions, 1)
		require.Equal(t, &detail.Conditions[0], detail.Summary.Accepted)
		require.Equal(t, condition.Status, detail.Conditions[0].Status)
		require.Equal(t, condition.Reason, detail.Conditions[0].Reason)
		require.Equal(t, condition.Message, detail.Conditions[0].Message)
		if transition.IsZero() {
			require.Empty(t, detail.Conditions[0].LastTransitionTime)
		} else {
			parsed, err := time.Parse("2006-01-02 15:04:05", detail.Conditions[0].LastTransitionTime)
			require.NoError(t, err)
			require.Equal(t, transition.Time, parsed)
		}
		require.Nil(t, detail.Summary.Ready)
	}
}

// The route Overview draws each rule from these fields, so the wire shape must carry every match
// condition and each backend's target, port, and weight.
func TestRouteDetailsCarryRuleMatchesAndBackendTraffic(t *testing.T) {
	port := int32(8080)
	link := resourcemodel.GatewayBackendRefLink("cluster-a", "shop", gatewayv1.BackendObjectReference{Name: "api"})
	detail := RouteDetailsFromFacts("HTTPRoute", metav1.ObjectMeta{Name: "api", Namespace: "shop"}, resourcemodel.RouteCommonFacts{
		Rules: []resourcemodel.RouteRuleFacts{{
			Matches: []resourcemodel.RouteMatchFacts{{
				Path:        &resourcemodel.RouteValueMatchFacts{Type: "PathPrefix", Value: "/api"},
				Method:      "GET",
				Headers:     []resourcemodel.RouteNamedMatchFacts{{Type: "Exact", Name: "x-canary", Value: "true"}},
				QueryParams: []resourcemodel.RouteNamedMatchFacts{{Type: "Exact", Name: "v", Value: "2"}},
			}, {
				GRPCMethod: &resourcemodel.RouteGRPCMethodFacts{Type: "Exact", Service: "orders.OrderService"},
			}},
			Backends: []resourcemodel.RouteBackendFacts{{Link: link, Port: &port, Weight: 90}},
		}},
	})

	require.Len(t, detail.Rules, 1)
	matches, err := json.Marshal(detail.Rules[0].Matches)
	require.NoError(t, err)
	require.JSONEq(t, `[
		{"path":{"type":"PathPrefix","value":"/api"},"method":"GET",
		 "headers":[{"type":"Exact","name":"x-canary","value":"true"}],
		 "queryParams":[{"type":"Exact","name":"v","value":"2"}]},
		{"grpcMethod":{"type":"Exact","service":"orders.OrderService"}}
	]`, string(matches))

	backend := detail.Rules[0].BackendRefs[0]
	require.NotNil(t, backend.Target.Ref)
	require.Equal(t, "Service", backend.Target.Ref.Kind)
	require.Equal(t, "api", backend.Target.Ref.Name)
	require.Equal(t, int32(8080), *backend.Port)
	require.Equal(t, int32(90), backend.Weight)
}
