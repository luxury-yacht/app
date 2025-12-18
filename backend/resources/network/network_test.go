package network_test

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	discoveryv1 "k8s.io/api/discovery/v1"
	networkingv1 "k8s.io/api/networking/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/util/intstr"
	kubefake "k8s.io/client-go/kubernetes/fake"
	k8stesting "k8s.io/client-go/testing"

	"github.com/luxury-yacht/app/backend/resources/network"
	"github.com/luxury-yacht/app/backend/testsupport"
)

type stubLogger struct{}

func (stubLogger) Debug(string, ...string) {}
func (stubLogger) Info(string, ...string)  {}
func (stubLogger) Warn(string, ...string)  {}
func (stubLogger) Error(string, ...string) {}

func TestManagerServiceDetails(t *testing.T) {
	service := &corev1.Service{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "web",
			Namespace:         "default",
			CreationTimestamp: metav1.NewTime(time.Now().Add(-10 * time.Minute)),
			Labels:            map[string]string{"app": "web"},
		},
		Spec: corev1.ServiceSpec{
			Type:            corev1.ServiceTypeLoadBalancer,
			ClusterIP:       "10.0.0.1",
			ClusterIPs:      []string{"10.0.0.1"},
			SessionAffinity: corev1.ServiceAffinityClientIP,
			ExternalIPs:     []string{"52.1.1.1"},
			SessionAffinityConfig: &corev1.SessionAffinityConfig{
				ClientIP: &corev1.ClientIPConfig{TimeoutSeconds: ptrToInt32(10800)},
			},
			Ports: []corev1.ServicePort{{
				Name:       "http",
				Protocol:   corev1.ProtocolTCP,
				Port:       80,
				TargetPort: intstrFromInt(8080),
				NodePort:   32080,
			}},
			Selector: map[string]string{"app": "web"},
		},
		Status: corev1.ServiceStatus{
			LoadBalancer: corev1.LoadBalancerStatus{
				Ingress: []corev1.LoadBalancerIngress{{IP: "35.1.2.3"}},
			},
		},
	}

	portName := "http"
	portValue := int32(8080)
	protocol := corev1.ProtocolTCP
	ready := true
	slice := &discoveryv1.EndpointSlice{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "web-abcde",
			Namespace: "default",
			Labels: map[string]string{
				discoveryv1.LabelServiceName: service.Name,
			},
		},
		AddressType: discoveryv1.AddressTypeIPv4,
		Ports: []discoveryv1.EndpointPort{{
			Name:     &portName,
			Port:     &portValue,
			Protocol: &protocol,
		}},
		Endpoints: []discoveryv1.Endpoint{{
			Addresses: []string{"10.2.0.5"},
			Conditions: discoveryv1.EndpointConditions{
				Ready: &ready,
			},
		}},
	}

	client := kubefake.NewSimpleClientset(service, slice)
	manager := newManager(t, client)

	detail, err := manager.GetService("default", "web")
	require.NoError(t, err)
	require.Equal(t, "Service", detail.Kind)
	require.Equal(t, "Healthy", detail.HealthStatus)
	require.Equal(t, "LoadBalancer", detail.ServiceType)
	require.Equal(t, "10.0.0.1", detail.ClusterIP)
	require.Contains(t, detail.Endpoints, "10.2.0.5:8080")
	require.Equal(t, "Active", detail.LoadBalancerStatus)
}

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

	client := kubefake.NewSimpleClientset(ing)
	manager := newManager(t, client)

	detail, err := manager.Ingress("default", "web")
	require.NoError(t, err)
	require.Equal(t, "Ingress", detail.Kind)
	require.Equal(t, 1, len(detail.Rules))
	require.Contains(t, detail.Details, "Host: app.example.com")
	require.Contains(t, detail.LoadBalancerStatus, "lb.example.com")
}

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

	client := kubefake.NewSimpleClientset(np)
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

	client := kubefake.NewSimpleClientset(np)
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

	client := kubefake.NewSimpleClientset(allowAll, restrict)
	manager := newManager(t, client)

	allPolicies, err := manager.NetworkPolicies("default")
	require.NoError(t, err)
	require.Len(t, allPolicies, 2)
	require.Equal(t, "NetworkPolicy", allPolicies[0].Kind)
	require.Contains(t, allPolicies[0].Details, "All pods")
	require.Contains(t, allPolicies[1].Details, "1 egress rules")
}

func TestManagerServiceErrorWhenGetFails(t *testing.T) {
	client := kubefake.NewSimpleClientset()
	client.PrependReactor("get", "services", func(action k8stesting.Action) (bool, runtime.Object, error) {
		return true, nil, fmt.Errorf("boom")
	})

	manager := newManager(t, client)

	_, err := manager.GetService("default", "web")
	require.Error(t, err)
	require.Contains(t, err.Error(), "failed to get service")
}

func TestManagerServicesHandlesEndpointListError(t *testing.T) {
	service := &corev1.Service{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "web",
			Namespace: "default",
		},
		Spec: corev1.ServiceSpec{
			Type:      corev1.ServiceTypeClusterIP,
			ClusterIP: "10.0.0.1",
		},
	}

	client := kubefake.NewSimpleClientset(service)
	client.PrependReactor("list", "endpointslices", func(action k8stesting.Action) (bool, runtime.Object, error) {
		return true, nil, fmt.Errorf("endpoint slices down")
	})

	manager := newManager(t, client)

	services, err := manager.Services("default")
	require.NoError(t, err)
	require.Len(t, services, 1)
	require.Equal(t, "Unknown", services[0].HealthStatus)
	require.Contains(t, services[0].Details, "ClusterIP")
}

func TestManagerServicesReflectsPendingLoadBalancer(t *testing.T) {
	service := &corev1.Service{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "lb-web",
			Namespace: "default",
		},
		Spec: corev1.ServiceSpec{
			Type:      corev1.ServiceTypeLoadBalancer,
			ClusterIP: "10.0.0.2",
			Ports: []corev1.ServicePort{{
				Port: 80,
			}},
		},
		Status: corev1.ServiceStatus{
			LoadBalancer: corev1.LoadBalancerStatus{
				Ingress: []corev1.LoadBalancerIngress{{Hostname: ""}},
			},
		},
	}

	client := kubefake.NewSimpleClientset(service)
	manager := newManager(t, client)

	detail, err := manager.GetService("default", "lb-web")
	require.NoError(t, err)
	require.Equal(t, "Pending", detail.LoadBalancerStatus)
	require.Equal(t, "", detail.LoadBalancerIP)
	require.Contains(t, detail.Details, "LoadBalancer")
}

func TestManagerServicesLoadBalancerActiveWhenIngressPresent(t *testing.T) {
	service := &corev1.Service{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "lb-active",
			Namespace: "default",
		},
		Spec: corev1.ServiceSpec{
			Type:      corev1.ServiceTypeLoadBalancer,
			ClusterIP: "10.0.0.3",
			Ports: []corev1.ServicePort{{
				Port:     443,
				NodePort: 32443,
			}},
		},
		Status: corev1.ServiceStatus{
			LoadBalancer: corev1.LoadBalancerStatus{
				Ingress: []corev1.LoadBalancerIngress{
					{IP: ""},
					{Hostname: "lb.example.com"},
				},
			},
		},
	}

	portValue := int32(443)
	protocol := corev1.ProtocolTCP
	ready := true
	slice := &discoveryv1.EndpointSlice{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "lb-active-abc",
			Namespace: "default",
			Labels: map[string]string{
				discoveryv1.LabelServiceName: service.Name,
			},
		},
		AddressType: discoveryv1.AddressTypeIPv4,
		Ports: []discoveryv1.EndpointPort{{
			Port:     &portValue,
			Protocol: &protocol,
		}},
		Endpoints: []discoveryv1.Endpoint{{
			Addresses: []string{"10.2.0.10"},
			Conditions: discoveryv1.EndpointConditions{
				Ready: &ready,
			},
		}},
	}

	client := kubefake.NewSimpleClientset(service, slice)
	manager := newManager(t, client)

	detail, err := manager.GetService("default", "lb-active")
	require.NoError(t, err)
	require.Equal(t, "Active", detail.LoadBalancerStatus)
	require.Equal(t, "lb.example.com", detail.LoadBalancerIP)
	require.Equal(t, "Healthy", detail.HealthStatus)
}

func TestManagerNetworkPoliciesErrorWhenListFails(t *testing.T) {
	client := kubefake.NewSimpleClientset()
	client.PrependReactor("list", "networkpolicies", func(action k8stesting.Action) (bool, runtime.Object, error) {
		return true, nil, fmt.Errorf("api down")
	})

	manager := newManager(t, client)

	_, err := manager.NetworkPolicies("default")
	require.Error(t, err)
	require.Contains(t, err.Error(), "failed to list network policies")
}

func TestManagerNetworkPolicyErrorWhenGetFails(t *testing.T) {
	client := kubefake.NewSimpleClientset()
	client.PrependReactor("get", "networkpolicies", func(action k8stesting.Action) (bool, runtime.Object, error) {
		return true, nil, fmt.Errorf("boom")
	})

	manager := newManager(t, client)

	_, err := manager.NetworkPolicy("default", "missing")
	require.Error(t, err)
	require.Contains(t, err.Error(), "failed to get network policy")
}

func TestManagerIngressesErrorWhenListFails(t *testing.T) {
	client := kubefake.NewSimpleClientset()
	client.PrependReactor("list", "ingresses", func(action k8stesting.Action) (bool, runtime.Object, error) {
		return true, nil, fmt.Errorf("api down")
	})

	manager := newManager(t, client)

	_, err := manager.Ingresses("default")
	require.Error(t, err)
	require.Contains(t, err.Error(), "failed to list ingresses")
}

func newManager(t testing.TB, client *kubefake.Clientset) *network.Service {
	t.Helper()
	deps := testsupport.NewResourceDependencies(
		testsupport.WithDepsContext(context.Background()),
		testsupport.WithDepsKubeClient(client),
		testsupport.WithDepsLogger(stubLogger{}),
	)
	return network.NewService(network.Dependencies{Common: deps})
}

func ptrToInt32(v int32) *int32 {
	return &v
}

func ptrToString(s string) *string {
	return &s
}

func intstrFromInt(v int) intstr.IntOrString {
	return intstr.FromInt(v)
}
