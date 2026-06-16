package gatewayclass

import (
	"testing"

	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/stretchr/testify/require"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	gatewayv1 "sigs.k8s.io/gateway-api/apis/v1"
)

func TestBuildResourceModelFactsStatusAndDisplayParameter(t *testing.T) {
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

	model := BuildResourceModel("cluster-a", gatewayClass)
	require.Equal(t, "cluster-a", model.Ref.ClusterID)
	require.Equal(t, "gateway.networking.k8s.io", model.Ref.Group)
	require.Equal(t, "v1", model.Ref.Version)
	require.Equal(t, "GatewayClass", model.Ref.Kind)
	require.Equal(t, "gatewayclasses", model.Ref.Resource)
	require.Equal(t, resourcemodel.ResourceScopeCluster, model.Scope)
	require.Equal(t, "True", model.Status.State)
	require.Equal(t, "Accepted", model.Status.Label)
	require.Equal(t, "ready", model.Status.Presentation)

	facts := BuildFacts("cluster-a", gatewayClass)
	require.Equal(t, "example.com/gateway-controller", facts.ControllerName)
	require.NotNil(t, facts.Summary.Accepted)
	require.NotNil(t, facts.Parameters.Display)
	require.Nil(t, facts.Parameters.Ref)
	require.Equal(t, "example.com", facts.Parameters.Display.Group)
	require.Equal(t, "GatewayParameters", facts.Parameters.Display.Kind)
	require.Equal(t, "platform", facts.Parameters.Display.Namespace)
	require.Equal(t, "public", facts.Parameters.Display.Name)
}
