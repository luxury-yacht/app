package resourcemodel

import (
	"testing"

	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	discoveryv1 "k8s.io/api/discovery/v1"
	networkingv1 "k8s.io/api/networking/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/apimachinery/pkg/util/intstr"
)

func TestBuildServiceResourceModelFactsAndStatus(t *testing.T) {
	ready := true
	notReady := false
	port := int32(8443)
	protocol := corev1.ProtocolTCP
	service := &corev1.Service{
		ObjectMeta: metav1.ObjectMeta{Name: "api", Namespace: "default", UID: types.UID("service-uid")},
		Spec: corev1.ServiceSpec{
			Type:                  corev1.ServiceTypeLoadBalancer,
			ClusterIP:             "10.0.0.10",
			ClusterIPs:            []string{"10.0.0.10"},
			ExternalIPs:           []string{"198.51.100.10"},
			SessionAffinity:       corev1.ServiceAffinityClientIP,
			SessionAffinityConfig: &corev1.SessionAffinityConfig{ClientIP: &corev1.ClientIPConfig{TimeoutSeconds: ptrInt32(60)}},
			Selector:              map[string]string{"app": "api"},
			Ports: []corev1.ServicePort{{
				Name:       "https",
				Protocol:   corev1.ProtocolTCP,
				Port:       443,
				TargetPort: intstr.FromString("https"),
				NodePort:   30443,
			}},
		},
		Status: corev1.ServiceStatus{
			LoadBalancer: corev1.LoadBalancerStatus{Ingress: []corev1.LoadBalancerIngress{{IP: "203.0.113.10"}}},
		},
	}
	slices := []*discoveryv1.EndpointSlice{{
		ObjectMeta:  metav1.ObjectMeta{Name: "api-a", Namespace: "default"},
		AddressType: discoveryv1.AddressTypeIPv4,
		Ports:       []discoveryv1.EndpointPort{{Port: &port, Protocol: &protocol}},
		Endpoints: []discoveryv1.Endpoint{
			{Addresses: []string{"10.244.0.10"}, Conditions: discoveryv1.EndpointConditions{Ready: &ready}},
			{Addresses: []string{"10.244.0.11"}, Conditions: discoveryv1.EndpointConditions{Ready: &notReady}},
		},
	}}

	model := BuildServiceResourceModel("cluster-a", service, slices)
	require.Equal(t, "cluster-a", model.Ref.ClusterID)
	require.Equal(t, "", model.Ref.Group)
	require.Equal(t, "v1", model.Ref.Version)
	require.Equal(t, "Service", model.Ref.Kind)
	require.Equal(t, "services", model.Ref.Resource)
	require.Equal(t, "default", model.Ref.Namespace)
	require.Equal(t, "LoadBalancer", model.Status.State)
	require.Equal(t, "LoadBalancer active", model.Status.Label)
	require.Equal(t, "ready", model.Status.Presentation)
	require.Equal(t, "LoadBalancer", model.Facts.Service.Type)
	require.Equal(t, []string{"203.0.113.10"}, model.Facts.Service.LoadBalancerAddresses)
	require.Equal(t, []string{"10.244.0.10:8443"}, model.Facts.Service.Endpoints)
	require.Equal(t, 1, model.Facts.Service.ReadyEndpointCount)
	require.Equal(t, 1, model.Facts.Service.NotReadyEndpointCount)
	require.Equal(t, int32(60), model.Facts.Service.SessionAffinityTimeout)
	require.Equal(t, int32(30443), model.Facts.Service.Ports[0].NodePort)
}

func TestBuildEndpointSliceResourceModelFactsAndStatus(t *testing.T) {
	notReady := false
	terminating := true
	portName := "http"
	portValue := int32(8080)
	protocol := corev1.ProtocolTCP
	appProtocol := "kubernetes.io/h2c"
	slice := &discoveryv1.EndpointSlice{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "api-a",
			Namespace: "default",
			Labels:    map[string]string{discoveryv1.LabelServiceName: "api"},
			UID:       types.UID("slice-uid"),
		},
		AddressType: discoveryv1.AddressTypeIPv4,
		Ports: []discoveryv1.EndpointPort{{
			Name:        &portName,
			Port:        &portValue,
			Protocol:    &protocol,
			AppProtocol: &appProtocol,
		}},
		Endpoints: []discoveryv1.Endpoint{{
			Addresses: []string{"10.244.0.10"},
			Conditions: discoveryv1.EndpointConditions{
				Ready:       &notReady,
				Terminating: &terminating,
			},
			TargetRef: &corev1.ObjectReference{
				APIVersion: "v1",
				Kind:       "Pod",
				Name:       "api-0",
				UID:        types.UID("pod-uid"),
			},
		}},
	}

	model := BuildEndpointSliceResourceModel("cluster-a", slice)
	require.Equal(t, "EndpointSlice", model.Ref.Kind)
	require.Equal(t, "endpointslices", model.Ref.Resource)
	require.Equal(t, "0", model.Status.State)
	require.Equal(t, "No ready addresses", model.Status.Label)
	require.Equal(t, "warning", model.Status.Presentation)
	require.Len(t, model.Facts.EndpointSlice.NotReadyAddresses, 1)
	require.Equal(t, "10.244.0.10", model.Facts.EndpointSlice.NotReadyAddresses[0].IP)
	require.NotNil(t, model.Facts.EndpointSlice.NotReadyAddresses[0].TargetRef.Ref)
	require.Nil(t, model.Facts.EndpointSlice.NotReadyAddresses[0].TargetRef.Display)
	require.Equal(t, "cluster-a", model.Facts.EndpointSlice.NotReadyAddresses[0].TargetRef.Ref.ClusterID)
	require.Equal(t, "v1", model.Facts.EndpointSlice.NotReadyAddresses[0].TargetRef.Ref.Version)
	require.Equal(t, "Pod", model.Facts.EndpointSlice.NotReadyAddresses[0].TargetRef.Ref.Kind)
	require.Equal(t, "default", model.Facts.EndpointSlice.NotReadyAddresses[0].TargetRef.Ref.Namespace)
	require.Equal(t, "api-0", model.Facts.EndpointSlice.NotReadyAddresses[0].TargetRef.Ref.Name)
	require.Equal(t, "Service", model.Facts.EndpointSlice.Service.Display.Kind)
	require.Equal(t, "api", model.Facts.EndpointSlice.Service.Display.Name)
	require.Equal(t, "http", model.Facts.EndpointSlice.Ports[0].Name)
	require.Equal(t, int32(8080), model.Facts.EndpointSlice.Ports[0].Port)
	require.Equal(t, "TCP", model.Facts.EndpointSlice.Ports[0].Protocol)
	require.Equal(t, "kubernetes.io/h2c", model.Facts.EndpointSlice.Ports[0].AppProtocol)
}

func TestBuildIngressResourceModelFactsAndStatus(t *testing.T) {
	pathType := networkingv1.PathTypePrefix
	ingress := &networkingv1.Ingress{
		ObjectMeta: metav1.ObjectMeta{Name: "web", Namespace: "default", UID: types.UID("ingress-uid")},
		Spec: networkingv1.IngressSpec{
			IngressClassName: networkStringPtr("nginx"),
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

	model := BuildIngressResourceModel("cluster-a", ingress)
	require.Equal(t, "networking.k8s.io", model.Ref.Group)
	require.Equal(t, "Ingress", model.Ref.Kind)
	require.Equal(t, "1", model.Status.State)
	require.Equal(t, "Address assigned", model.Status.Label)
	require.Equal(t, "ready", model.Status.Presentation)
	require.Equal(t, []string{"lb.example.com"}, model.Facts.Ingress.Addresses)
	require.Equal(t, "nginx", model.Facts.Ingress.ClassName)
	require.Equal(t, "cluster-a", model.Facts.Ingress.Class.Ref.ClusterID)
	require.Equal(t, "IngressClass", model.Facts.Ingress.Class.Ref.Kind)
	require.Equal(t, "nginx", model.Facts.Ingress.Class.Ref.Name)
	require.Equal(t, "Secret", model.Facts.Ingress.TLS[0].SecretRef.Display.Kind)
	require.Equal(t, "web-tls", model.Facts.Ingress.TLS[0].SecretRef.Display.Name)
	require.Equal(t, "web", model.Facts.Ingress.Rules[0].Paths[0].Backend.Service.Display.Name)
	require.Equal(t, "80", model.Facts.Ingress.Rules[0].Paths[0].Backend.ServicePort)
	require.Equal(t, "fallback", model.Facts.Ingress.DefaultBackend.Service.Display.Name)
	require.Len(t, model.Facts.Ingress.BackendRefs, 2)
}

func TestBuildNetworkPolicyResourceModelFactsAndStatus(t *testing.T) {
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

	model := BuildNetworkPolicyResourceModel("cluster-a", policy)
	require.Equal(t, "NetworkPolicy", model.Ref.Kind)
	require.Equal(t, "1/1", model.Status.State)
	require.Equal(t, "Ingress,Egress, 1 ingress, 1 egress", model.Status.Label)
	require.Equal(t, "ready", model.Status.Presentation)
	require.Equal(t, []string{"Ingress", "Egress"}, model.Facts.NetworkPolicy.PolicyTypes)
	require.Equal(t, map[string]string{"app": "web"}, model.Facts.NetworkPolicy.PodSelector)
	require.Equal(t, map[string]string{"team": "frontend"}, model.Facts.NetworkPolicy.IngressRules[0].Peers[0].NamespaceSelector)
	require.Equal(t, map[string]string{"role": "client"}, model.Facts.NetworkPolicy.IngressRules[0].Peers[0].PodSelector)
	require.Equal(t, "TCP", model.Facts.NetworkPolicy.IngressRules[0].Ports[0].Protocol)
	require.Equal(t, "https", model.Facts.NetworkPolicy.IngressRules[0].Ports[0].Port)
	require.NotNil(t, model.Facts.NetworkPolicy.IngressRules[0].Ports[0].EndPort)
	require.Equal(t, endPort, *model.Facts.NetworkPolicy.IngressRules[0].Ports[0].EndPort)
	require.Equal(t, "10.0.0.0/8", model.Facts.NetworkPolicy.EgressRules[0].Peers[0].IPBlock.CIDR)
	require.Equal(t, []string{"10.1.0.0/16"}, model.Facts.NetworkPolicy.EgressRules[0].Peers[0].IPBlock.Except)
}

func networkStringPtr(value string) *string {
	return &value
}

func ptrInt32(value int32) *int32 {
	return &value
}
