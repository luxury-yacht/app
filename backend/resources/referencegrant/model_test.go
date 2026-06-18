package referencegrant

import (
	"testing"

	"github.com/stretchr/testify/require"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	gatewayv1 "sigs.k8s.io/gateway-api/apis/v1"
)

func TestBuildResourceModelFactsAndDisplayLinks(t *testing.T) {
	customGroup := gatewayv1.Group("example.com")
	customKind := gatewayv1.Kind("Widget")
	grant := &gatewayv1.ReferenceGrant{
		ObjectMeta: metav1.ObjectMeta{Name: "allow-widgets", Namespace: "default"},
		Spec: gatewayv1.ReferenceGrantSpec{
			From: []gatewayv1.ReferenceGrantFrom{{Group: gatewayv1.Group("gateway.networking.k8s.io"), Kind: gatewayv1.Kind("HTTPRoute"), Namespace: gatewayv1.Namespace("apps")}},
			To:   []gatewayv1.ReferenceGrantTo{{Group: customGroup, Kind: customKind}},
		},
	}
	model := BuildResourceModel("cluster-a", grant)
	require.Equal(t, "1", model.Status.State)
	require.Equal(t, "1 from, 1 to", model.Status.Label)

	facts := BuildFacts("cluster-a", grant)
	require.Equal(t, "apps", facts.From[0].Namespace)
	require.NotNil(t, facts.To[0].Display)
	require.Nil(t, facts.To[0].Ref)
	require.Equal(t, "Widget", facts.To[0].Display.Kind)
}
