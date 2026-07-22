/*
 * backend/resources/networkpolicy/details_test.go
 *
 * Tests for the NetworkPolicy detail service (co-located with the kind).
 */

package networkpolicy_test

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/util/intstr"
	"k8s.io/client-go/kubernetes/fake"
	k8stesting "k8s.io/client-go/testing"

	"github.com/luxury-yacht/app/backend/internal/applog"
	"github.com/luxury-yacht/app/backend/resources/networkpolicy"
	"github.com/luxury-yacht/app/backend/testsupport"
)

func newService(t testing.TB, client *fake.Clientset) *networkpolicy.Service {
	t.Helper()
	deps := testsupport.NewResourceDependencies(
		testsupport.WithDepsContext(context.Background()),
		testsupport.WithDepsKubeClient(client),
		testsupport.WithDepsLogger(applog.Noop),
	)
	return networkpolicy.NewService(deps)
}

func TestNetworkPolicyDetails(t *testing.T) {
	protocolTCP := corev1.ProtocolTCP
	port := intstr.FromInt(80)

	np := &networkingv1.NetworkPolicy{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "allow-http",
			Namespace:         "default",
			CreationTimestamp: metav1.NewTime(time.Now().Add(-45 * time.Minute)),
		},
		Spec: networkingv1.NetworkPolicySpec{
			PodSelector: metav1.LabelSelector{MatchLabels: map[string]string{"app": "web"}},
			PolicyTypes: []networkingv1.PolicyType{networkingv1.PolicyTypeIngress},
			Ingress: []networkingv1.NetworkPolicyIngressRule{{
				From: []networkingv1.NetworkPolicyPeer{{
					NamespaceSelector: &metav1.LabelSelector{MatchLabels: map[string]string{"env": "prod"}},
				}},
				Ports: []networkingv1.NetworkPolicyPort{{
					Protocol: &protocolTCP,
					Port:     &port,
				}},
			}},
		},
	}

	client := fake.NewClientset(np)
	service := newService(t, client)

	detail, err := service.NetworkPolicy("default", "allow-http")
	require.NoError(t, err)
	require.Equal(t, "NetworkPolicy", detail.Kind)
	require.Len(t, detail.IngressRules, 1)
	require.Contains(t, detail.Details, "ingress")
}

func TestNetworkPolicyDetailsWithEgressAndIPBlock(t *testing.T) {
	protocolUDP := corev1.ProtocolUDP
	startPort := intstr.FromInt(53)
	endPort := int32(55)

	np := &networkingv1.NetworkPolicy{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "dns-egress",
			Namespace:         "default",
			CreationTimestamp: metav1.NewTime(time.Now().Add(-15 * time.Minute)),
		},
		Spec: networkingv1.NetworkPolicySpec{
			PodSelector: metav1.LabelSelector{},
			PolicyTypes: []networkingv1.PolicyType{
				networkingv1.PolicyTypeIngress,
				networkingv1.PolicyTypeEgress,
			},
			Egress: []networkingv1.NetworkPolicyEgressRule{{
				To: []networkingv1.NetworkPolicyPeer{{
					IPBlock: &networkingv1.IPBlock{
						CIDR:   "10.0.0.0/24",
						Except: []string{"10.0.0.10/32"},
					},
				}},
				Ports: []networkingv1.NetworkPolicyPort{{
					Protocol: &protocolUDP,
					Port:     &startPort,
					EndPort:  &endPort,
				}},
			}},
		},
	}

	client := fake.NewClientset(np)
	service := newService(t, client)

	detail, err := service.NetworkPolicy("default", "dns-egress")
	require.NoError(t, err)
	require.Contains(t, detail.Details, "All pods")
	require.Len(t, detail.EgressRules, 1)
	require.Equal(t, []string{"Ingress", "Egress"}, detail.PolicyTypes)
	require.NotNil(t, detail.EgressRules[0].Ports[0].EndPort)
	require.EqualValues(t, 55, *detail.EgressRules[0].Ports[0].EndPort)
	require.Equal(t, "UDP", detail.EgressRules[0].Ports[0].Protocol)
	require.NotNil(t, detail.EgressRules[0].To[0].IPBlock)
	require.Equal(t, "10.0.0.0/24", detail.EgressRules[0].To[0].IPBlock.CIDR)
	require.Contains(t, detail.Details, "0 ingress, 1 egress rules")
}

func TestNetworkPolicyErrorWhenGetFails(t *testing.T) {
	client := fake.NewClientset()
	client.PrependReactor("get", "networkpolicies", func(action k8stesting.Action) (bool, runtime.Object, error) {
		return true, nil, fmt.Errorf("boom")
	})

	service := newService(t, client)

	_, err := service.NetworkPolicy("default", "missing")
	require.Error(t, err)
	require.Contains(t, err.Error(), "failed to get network policy")
}
