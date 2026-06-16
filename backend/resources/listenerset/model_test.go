package listenerset

import (
	"testing"

	"github.com/stretchr/testify/require"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	gatewayv1 "sigs.k8s.io/gateway-api/apis/v1"
)

func TestBuildResourceModelFactsAndParentLink(t *testing.T) {
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
	model := BuildResourceModel("cluster-a", listenerSet)
	require.Equal(t, "ListenerSet", model.Ref.Kind)
	require.Equal(t, "True", model.Status.State)

	facts := BuildFacts("cluster-a", listenerSet)
	require.Equal(t, "Gateway", facts.ParentRef.Ref.Kind)
	require.Equal(t, "edge", facts.ParentRef.Ref.Name)
}
