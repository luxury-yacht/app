/*
 * backend/resources/network/network_policies_test.go
 *
 * Tests for NetworkPolicy resource handlers.
 * - Covers NetworkPolicy resource handlers behavior and edge cases.
 */

package network

import (
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
)

func TestManagerNetworkPolicyDetails(t *testing.T) {
	protocolTCP := corev1.ProtocolTCP
	port := intstrFromInt(80)

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
	manager := newManager(t, client)

	detail, err := manager.NetworkPolicy("default", "allow-http")
	require.NoError(t, err)
	require.Equal(t, "NetworkPolicy", detail.Kind)
	require.Len(t, detail.IngressRules, 1)
	require.Contains(t, detail.Details, "ingress")
}

func TestManagerNetworkPolicyDetailsWithEgressAndIPBlock(t *testing.T) {
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
	manager := newManager(t, client)

	detail, err := manager.NetworkPolicy("default", "dns-egress")
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

func TestManagerNetworkPoliciesAggregatesMultipleResults(t *testing.T) {
	older := metav1.NewTime(time.Now().Add(-2 * time.Hour))
	allowAll := &networkingv1.NetworkPolicy{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "allow-all",
			Namespace:         "default",
			CreationTimestamp: older,
		},
		Spec: networkingv1.NetworkPolicySpec{
			PodSelector: metav1.LabelSelector{},
			PolicyTypes: []networkingv1.PolicyType{networkingv1.PolicyTypeIngress},
		},
	}
	restrict := &networkingv1.NetworkPolicy{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "restrict-db",
			Namespace: "default",
		},
		Spec: networkingv1.NetworkPolicySpec{
			PodSelector: metav1.LabelSelector{MatchLabels: map[string]string{"tier": "db"}},
			PolicyTypes: []networkingv1.PolicyType{networkingv1.PolicyTypeEgress},
			Egress: []networkingv1.NetworkPolicyEgressRule{{
				To: []networkingv1.NetworkPolicyPeer{{
					NamespaceSelector: &metav1.LabelSelector{MatchLabels: map[string]string{"env": "prod"}},
				}},
			}},
		},
	}

	client := fake.NewClientset(allowAll, restrict)
	manager := newManager(t, client)

	allPolicies, err := manager.NetworkPolicies("default")
	require.NoError(t, err)
	require.Len(t, allPolicies, 2)
	require.Equal(t, "NetworkPolicy", allPolicies[0].Kind)
	require.Contains(t, allPolicies[0].Details, "All pods")
	require.Contains(t, allPolicies[1].Details, "1 egress rules")
}

func TestManagerNetworkPoliciesErrorWhenListFails(t *testing.T) {
	client := fake.NewClientset()
	client.PrependReactor("list", "networkpolicies", func(action k8stesting.Action) (bool, runtime.Object, error) {
		return true, nil, fmt.Errorf("api down")
	})

	manager := newManager(t, client)

	_, err := manager.NetworkPolicies("default")
	require.Error(t, err)
	require.Contains(t, err.Error(), "failed to list network policies")
}

func TestManagerNetworkPolicyErrorWhenGetFails(t *testing.T) {
	client := fake.NewClientset()
	client.PrependReactor("get", "networkpolicies", func(action k8stesting.Action) (bool, runtime.Object, error) {
		return true, nil, fmt.Errorf("boom")
	})

	manager := newManager(t, client)

	_, err := manager.NetworkPolicy("default", "missing")
	require.Error(t, err)
	require.Contains(t, err.Error(), "failed to get network policy")
}
