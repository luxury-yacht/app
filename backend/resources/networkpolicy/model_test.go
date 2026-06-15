package networkpolicy_test

import (
	"testing"

	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/apimachinery/pkg/util/intstr"

	"github.com/luxury-yacht/app/backend/resources/networkpolicy"
)

// TestBuildResourceModelFactsAndStatus covers the NetworkPolicy status presentation
// + facts that moved here with the model (was in resourcemodel's network test).
func TestBuildResourceModelFactsAndStatus(t *testing.T) {
	protocol := corev1.ProtocolTCP
	endPort := int32(8443)
	policy := &networkingv1.NetworkPolicy{
		ObjectMeta: metav1.ObjectMeta{Name: "allow-web", Namespace: "default", UID: types.UID("policy-uid")},
		Spec: networkingv1.NetworkPolicySpec{
			PodSelector: metav1.LabelSelector{MatchLabels: map[string]string{"app": "web"}},
			Ingress: []networkingv1.NetworkPolicyIngressRule{{
				From: []networkingv1.NetworkPolicyPeer{{
					NamespaceSelector: &metav1.LabelSelector{MatchLabels: map[string]string{"team": "frontend"}},
					PodSelector:       &metav1.LabelSelector{MatchLabels: map[string]string{"role": "client"}},
				}},
				Ports: []networkingv1.NetworkPolicyPort{{
					Protocol: &protocol,
					Port:     &intstr.IntOrString{Type: intstr.String, StrVal: "https"},
					EndPort:  &endPort,
				}},
			}},
			Egress: []networkingv1.NetworkPolicyEgressRule{{
				To: []networkingv1.NetworkPolicyPeer{{IPBlock: &networkingv1.IPBlock{
					CIDR:   "10.0.0.0/8",
					Except: []string{"10.1.0.0/16"},
				}}},
			}},
		},
	}

	model := networkpolicy.BuildResourceModel("cluster-a", policy)
	require.Equal(t, "NetworkPolicy", model.Ref.Kind)
	require.Equal(t, "1/1", model.Status.State)
	require.Equal(t, "Ingress,Egress, 1 ingress, 1 egress", model.Status.Label)
	require.Equal(t, "ready", model.Status.Presentation)

	facts := networkpolicy.BuildFacts(policy)
	require.Equal(t, []string{"Ingress", "Egress"}, facts.PolicyTypes)
	require.Equal(t, map[string]string{"app": "web"}, facts.PodSelector)
	require.Equal(t, map[string]string{"team": "frontend"}, facts.IngressRules[0].Peers[0].NamespaceSelector)
	require.Equal(t, map[string]string{"role": "client"}, facts.IngressRules[0].Peers[0].PodSelector)
	require.Equal(t, "TCP", facts.IngressRules[0].Ports[0].Protocol)
	require.Equal(t, "https", facts.IngressRules[0].Ports[0].Port)
	require.NotNil(t, facts.IngressRules[0].Ports[0].EndPort)
	require.Equal(t, endPort, *facts.IngressRules[0].Ports[0].EndPort)
	require.Equal(t, "10.0.0.0/8", facts.EgressRules[0].Peers[0].IPBlock.CIDR)
	require.Equal(t, []string{"10.1.0.0/16"}, facts.EgressRules[0].Peers[0].IPBlock.Except)
}
