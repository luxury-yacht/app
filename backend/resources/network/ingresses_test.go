package network

import (
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	networkingv1 "k8s.io/api/networking/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	kubefake "k8s.io/client-go/kubernetes/fake"
	k8stesting "k8s.io/client-go/testing"
)

func TestManagerIngressDetails(t *testing.T) {
	pathType := networkingv1.PathTypePrefix
	ing := &networkingv1.Ingress{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "web",
			Namespace:         "default",
			CreationTimestamp: metav1.NewTime(time.Now().Add(-30 * time.Minute)),
		},
		Spec: networkingv1.IngressSpec{
			IngressClassName: ptrToString("nginx"),
			Rules: []networkingv1.IngressRule{{
				Host: "app.example.com",
				IngressRuleValue: networkingv1.IngressRuleValue{
					HTTP: &networkingv1.HTTPIngressRuleValue{
						Paths: []networkingv1.HTTPIngressPath{{
							Path:     "/",
							PathType: &pathType,
							Backend: networkingv1.IngressBackend{
								Service: &networkingv1.IngressServiceBackend{
									Name: "web",
									Port: networkingv1.ServiceBackendPort{Number: 80},
								},
							},
						}},
					},
				},
			}},
			TLS: []networkingv1.IngressTLS{{SecretName: "tls-secret"}},
		},
		Status: networkingv1.IngressStatus{
			LoadBalancer: networkingv1.IngressLoadBalancerStatus{
				Ingress: []networkingv1.IngressLoadBalancerIngress{{Hostname: "lb.example.com"}},
			},
		},
	}

	client := kubefake.NewClientset(ing)
	manager := newManager(t, client)

	detail, err := manager.Ingress("default", "web")
	require.NoError(t, err)
	require.Equal(t, "Ingress", detail.Kind)
	require.Equal(t, 1, len(detail.Rules))
	require.Contains(t, detail.Details, "Host: app.example.com")
	require.Contains(t, detail.LoadBalancerStatus, "lb.example.com")
}

func TestManagerIngressesErrorWhenListFails(t *testing.T) {
	client := kubefake.NewClientset()
	client.PrependReactor("list", "ingresses", func(action k8stesting.Action) (bool, runtime.Object, error) {
		return true, nil, fmt.Errorf("api down")
	})

	manager := newManager(t, client)

	_, err := manager.Ingresses("default")
	require.Error(t, err)
	require.Contains(t, err.Error(), "failed to list ingresses")
}
