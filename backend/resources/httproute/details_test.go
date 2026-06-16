package httproute

import (
	"testing"

	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/stretchr/testify/require"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	gatewayv1 "sigs.k8s.io/gateway-api/apis/v1"
)

func TestBuildDetailsUseSharedFactsAndDisplayOnlyRefs(t *testing.T) {
	service := NewService(common.Dependencies{ClusterID: "cluster-a"})
	customGroup := gatewayv1.Group("example.com")
	customKind := gatewayv1.Kind("Widget")
	route := &gatewayv1.HTTPRoute{
		ObjectMeta: metav1.ObjectMeta{Name: "api", Namespace: "default"},
		Spec: gatewayv1.HTTPRouteSpec{
			CommonRouteSpec: gatewayv1.CommonRouteSpec{
				ParentRefs: []gatewayv1.ParentReference{{Name: gatewayv1.ObjectName("edge")}},
			},
			Rules: []gatewayv1.HTTPRouteRule{{
				BackendRefs: []gatewayv1.HTTPBackendRef{{
					BackendRef: gatewayv1.BackendRef{
						BackendObjectReference: gatewayv1.BackendObjectReference{
							Group: &customGroup,
							Kind:  &customKind,
							Name:  gatewayv1.ObjectName("backend"),
						},
					},
				}},
			}},
		},
	}

	detail := service.buildDetails(route)
	require.Equal(t, "HTTPRoute", detail.Kind)
	require.NotNil(t, detail.ParentRefs[0].Ref)
	require.Equal(t, "Gateway", detail.ParentRefs[0].Ref.Kind)
	require.Equal(t, "default", detail.ParentRefs[0].Ref.Namespace)
	require.NotNil(t, detail.BackendRefs[0].Display)
	require.Nil(t, detail.BackendRefs[0].Ref)
	require.Equal(t, "example.com", detail.BackendRefs[0].Display.Group)
	require.Equal(t, "Widget", detail.BackendRefs[0].Display.Kind)
	require.Equal(t, "backend", detail.BackendRefs[0].Display.Name)
	require.NotNil(t, detail.Rules[0].BackendRefs[0].Display)
}
