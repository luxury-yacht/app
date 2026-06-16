package backendtlspolicy

import (
	"testing"

	"github.com/stretchr/testify/require"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	gatewayv1 "sigs.k8s.io/gateway-api/apis/v1"
)

func TestBuildResourceModelFactsAndTargetLinks(t *testing.T) {
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
	model := BuildResourceModel("cluster-a", policy)
	require.Equal(t, "True", model.Status.State)

	facts := BuildFacts("cluster-a", policy)
	require.Equal(t, "Service", facts.TargetRefs[0].Ref.Kind)
	require.Equal(t, "default", facts.TargetRefs[0].Ref.Namespace)
	require.Equal(t, "api", facts.TargetRefs[0].Ref.Name)
}
