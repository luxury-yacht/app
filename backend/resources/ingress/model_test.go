package ingress

import (
	"testing"

	"github.com/stretchr/testify/require"
	networkingv1 "k8s.io/api/networking/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"

	"github.com/luxury-yacht/app/backend/resourcemodel"
)

func stringPtr(s string) *string { return &s }

func TestBuildIngressResourceModelFactsAndStatus(t *testing.T) {
	pathType := networkingv1.PathTypePrefix
	ingress := &networkingv1.Ingress{
		ObjectMeta: metav1.ObjectMeta{Name: "web", Namespace: "default", UID: types.UID("ingress-uid")},
		Spec: networkingv1.IngressSpec{
			IngressClassName: stringPtr("nginx"),
			DefaultBackend: &networkingv1.IngressBackend{
				Service: &networkingv1.IngressServiceBackend{Name: "fallback", Port: networkingv1.ServiceBackendPort{Name: "http"}},
			},
			TLS: []networkingv1.IngressTLS{{Hosts: []string{"web.example.com"}, SecretName: "web-tls"}},
			Rules: []networkingv1.IngressRule{{
				Host: "web.example.com",
				IngressRuleValue: networkingv1.IngressRuleValue{HTTP: &networkingv1.HTTPIngressRuleValue{Paths: []networkingv1.HTTPIngressPath{{
					Path:     "/",
					PathType: &pathType,
					Backend: networkingv1.IngressBackend{
						Service: &networkingv1.IngressServiceBackend{Name: "web", Port: networkingv1.ServiceBackendPort{Number: 80}},
					},
				}}}},
			}},
		},
		Status: networkingv1.IngressStatus{
			LoadBalancer: networkingv1.IngressLoadBalancerStatus{Ingress: []networkingv1.IngressLoadBalancerIngress{{Hostname: "lb.example.com"}}},
		},
	}

	model := BuildResourceModel("cluster-a", ingress)
	require.Equal(t, "networking.k8s.io", model.Ref.Group)
	require.Equal(t, "Ingress", model.Ref.Kind)
	require.Equal(t, "1", model.Status.State)
	require.Equal(t, "Address assigned", model.Status.Label)
	require.Equal(t, "ready", model.Status.Presentation)

	facts := BuildFacts("cluster-a", ingress)
	require.Equal(t, []string{"lb.example.com"}, facts.Addresses)
	require.Equal(t, "nginx", facts.ClassName)
	require.Equal(t, "cluster-a", facts.Class.Ref.ClusterID)
	require.Equal(t, "IngressClass", facts.Class.Ref.Kind)
	require.Equal(t, "nginx", facts.Class.Ref.Name)
	require.Equal(t, "Secret", facts.TLS[0].SecretRef.Display.Kind)
	require.Equal(t, "web-tls", facts.TLS[0].SecretRef.Display.Name)
	require.Equal(t, "web", facts.Rules[0].Paths[0].Backend.Service.Display.Name)
	require.Equal(t, "80", facts.Rules[0].Paths[0].Backend.ServicePort)
	require.Equal(t, "fallback", facts.DefaultBackend.Service.Display.Name)
	require.Len(t, facts.BackendRefs, 2)
}

func TestSummarySegments(t *testing.T) {
	class := &resourcemodel.ResourceLink{Ref: &resourcemodel.ResourceRef{ClusterID: "c1", Group: "networking.k8s.io", Version: "v1", Kind: "IngressClass", Resource: "ingressclasses", Name: "nginx"}}
	facts := Facts{
		ClassName: "nginx",
		Class:     class,
		Hosts:     []string{"web.example.com", "api.example.com", "www.example.com"},
		Rules:     []RuleFacts{{Host: "web.example.com"}},
	}
	require.Equal(t, []resourcemodel.DetailSegment{
		{Slot: resourcemodel.DetailSlotReference, Label: "Class", Value: "nginx", Link: class},
		{Slot: resourcemodel.DetailSlotAddress, Label: "Hosts", Value: "web.example.com +2", Search: "web.example.com, api.example.com, www.example.com"},
		{Slot: resourcemodel.DetailSlotCounts, Label: "Rules", Value: "1"},
	}, SummarySegments(facts))
	require.Equal(t, []resourcemodel.DetailSegment{
		{Slot: resourcemodel.DetailSlotCounts, Label: "Rules", Value: "0"},
	}, SummarySegments(Facts{}))
}
