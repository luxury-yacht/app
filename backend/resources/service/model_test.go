package service

import (
	"testing"

	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	discoveryv1 "k8s.io/api/discovery/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/apimachinery/pkg/util/intstr"
)

func TestBuildServiceResourceModelFactsAndStatus(t *testing.T) {
	ready := true
	notReady := false
	port := int32(8443)
	protocol := corev1.ProtocolTCP
	svc := &corev1.Service{
		ObjectMeta: metav1.ObjectMeta{Name: "api", Namespace: "default", UID: types.UID("service-uid")},
		Spec: corev1.ServiceSpec{
			Type:                  corev1.ServiceTypeLoadBalancer,
			ClusterIP:             "10.0.0.10",
			ClusterIPs:            []string{"10.0.0.10"},
			ExternalIPs:           []string{"198.51.100.10"},
			SessionAffinity:       corev1.ServiceAffinityClientIP,
			SessionAffinityConfig: &corev1.SessionAffinityConfig{ClientIP: &corev1.ClientIPConfig{TimeoutSeconds: ptrToInt32(60)}},
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

	model := BuildResourceModel("cluster-a", svc, slices)
	require.Equal(t, "cluster-a", model.Ref.ClusterID)
	require.Equal(t, "", model.Ref.Group)
	require.Equal(t, "v1", model.Ref.Version)
	require.Equal(t, "Service", model.Ref.Kind)
	require.Equal(t, "services", model.Ref.Resource)
	require.Equal(t, "default", model.Ref.Namespace)
	require.Equal(t, "LoadBalancer", model.Status.State)
	require.Equal(t, "LoadBalancer active", model.Status.Label)
	require.Equal(t, "ready", model.Status.Presentation)

	facts := BuildFacts(svc, slices)
	require.Equal(t, "LoadBalancer", facts.Type)
	require.Equal(t, []string{"203.0.113.10"}, facts.LoadBalancerAddresses)
	require.Equal(t, []string{"10.244.0.10:8443"}, facts.Endpoints)
	require.Equal(t, 1, facts.ReadyEndpointCount)
	require.Equal(t, 1, facts.NotReadyEndpointCount)
	require.Equal(t, int32(60), facts.SessionAffinityTimeout)
	require.Equal(t, int32(30443), facts.Ports[0].NodePort)
}

func TestDescribeSummary(t *testing.T) {
	facts := Facts{
		Type:               "ClusterIP",
		ClusterIP:          "10.0.0.1",
		Ports:              []PortFacts{{Port: 80, Protocol: "TCP"}},
		ReadyEndpointCount: 2,
	}
	require.Equal(t, "Type: ClusterIP, ClusterIP: 10.0.0.1, Ports: 80/TCP, Addresses: 2", DescribeSummary(facts))
	require.Equal(t, "Type: , ClusterIP: None", DescribeSummary(Facts{}))
}
