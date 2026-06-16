package gatewayclass

import (
	"testing"

	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/stretchr/testify/require"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	gatewayv1 "sigs.k8s.io/gateway-api/apis/v1"
)

func TestBuildDetailsUsesSharedParameterLink(t *testing.T) {
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

	detail := service.buildDetails(gatewayClass)
	require.Equal(t, "example.com/controller", detail.Controller)
	require.NotNil(t, detail.Parameters.Ref)
	require.Equal(t, "v1", detail.Parameters.Ref.Version)
	require.Equal(t, "ConfigMap", detail.Parameters.Ref.Kind)
	require.Equal(t, "platform", detail.Parameters.Ref.Namespace)
	require.Equal(t, "params", detail.Parameters.Ref.Name)
}
