package network

import (
	"fmt"
	"testing"
	"time"

	corev1 "k8s.io/api/core/v1"
	discoveryv1 "k8s.io/api/discovery/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	kubefake "k8s.io/client-go/kubernetes/fake"
	k8stesting "k8s.io/client-go/testing"

	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/stretchr/testify/require"
)

func TestBuildServiceDetailsVariants(t *testing.T) {
	now := metav1.NewTime(time.Now())

	lbSvc := &corev1.Service{
		ObjectMeta: metav1.ObjectMeta{Name: "lb", Namespace: "default", CreationTimestamp: now},
		Spec: corev1.ServiceSpec{
			Type:      corev1.ServiceTypeLoadBalancer,
			ClusterIP: "10.0.0.9",
			Ports: []corev1.ServicePort{{
				Name:     "http",
				Port:     80,
				NodePort: 30080,
			}},
		},
		Status: corev1.ServiceStatus{
			LoadBalancer: corev1.LoadBalancerStatus{
				Ingress: []corev1.LoadBalancerIngress{{IP: "1.2.3.4"}},
			},
		},
	}

	port := int32(8080)
	ready := true
	withSlices := []*discoveryv1.EndpointSlice{{
		ObjectMeta: metav1.ObjectMeta{Name: "slice-1"},
		Ports:      []discoveryv1.EndpointPort{{Port: &port}},
		Endpoints: []discoveryv1.Endpoint{{
			Addresses: []string{"10.1.1.5"},
			Conditions: discoveryv1.EndpointConditions{
				Ready: &ready,
			},
		}},
	}}

	m := NewService(Dependencies{Common: common.Dependencies{}})
	detail := m.buildServiceDetails(lbSvc, withSlices)
	if detail.HealthStatus != "Healthy" || detail.LoadBalancerStatus != "Active" || detail.LoadBalancerIP != "1.2.3.4" {
		t.Fatalf("unexpected load balancer detail: %+v", detail)
	}
	if detail.EndpointCount != 1 || len(detail.Endpoints) != 1 {
		t.Fatalf("expected endpoint count =1 got %+v", detail.EndpointCount)
	}

	extSvc := &corev1.Service{
		ObjectMeta: metav1.ObjectMeta{Name: "ext", Namespace: "default", CreationTimestamp: now},
		Spec: corev1.ServiceSpec{
			Type:         corev1.ServiceTypeExternalName,
			ExternalName: "example.com",
			Ports:        []corev1.ServicePort{{Port: 443}},
		},
	}
	extDetail := m.buildServiceDetails(extSvc, []*discoveryv1.EndpointSlice{})
	if extDetail.HealthStatus != "External" {
		t.Fatalf("expected External health for external name service, got %s", extDetail.HealthStatus)
	}
	if extDetail.ExternalName != "example.com" {
		t.Fatalf("expected external name to be set, got %s", extDetail.ExternalName)
	}

	noSliceDetail := m.buildServiceDetails(lbSvc, nil)
	if noSliceDetail.HealthStatus != "Unknown" {
		t.Fatalf("expected Unknown health when endpoint slices missing, got %s", noSliceDetail.HealthStatus)
	}
}

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

	client := kubefake.NewClientset(service, slice)
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

func TestManagerServiceErrorWhenGetFails(t *testing.T) {
	client := kubefake.NewClientset()
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

	client := kubefake.NewClientset(service)
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

	client := kubefake.NewClientset(service)
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

	client := kubefake.NewClientset(service, slice)
	manager := newManager(t, client)

	detail, err := manager.GetService("default", "lb-active")
	require.NoError(t, err)
	require.Equal(t, "Active", detail.LoadBalancerStatus)
	require.Equal(t, "lb.example.com", detail.LoadBalancerIP)
	require.Equal(t, "Healthy", detail.HealthStatus)
}

func TestManagerServiceErrors(t *testing.T) {
	client := kubefake.NewClientset()
	client.PrependReactor("get", "services", func(k8stesting.Action) (bool, runtime.Object, error) {
		return true, nil, fmt.Errorf("boom")
	})

	manager := NewService(Dependencies{
		Common: common.Dependencies{
			KubernetesClient: client,
			Logger:           noopLogger{},
		},
	})

	_, err := manager.GetService("default", "web")
	require.Error(t, err)
}

func TestManagerServicesListError(t *testing.T) {
	client := kubefake.NewClientset()
	client.PrependReactor("list", "services", func(k8stesting.Action) (bool, runtime.Object, error) {
		return true, nil, fmt.Errorf("list failed")
	})

	manager := NewService(Dependencies{
		Common: common.Dependencies{
			KubernetesClient: client,
			Logger:           noopLogger{},
		},
	})

	_, err := manager.Services("default")
	require.Error(t, err)
}

func TestManagerServicesBuildsFromEndpointSlices(t *testing.T) {
	svc := &corev1.Service{
		ObjectMeta: metav1.ObjectMeta{Name: "web", Namespace: "default"},
		Spec: corev1.ServiceSpec{
			Type:      corev1.ServiceTypeClusterIP,
			ClusterIP: "10.0.0.5",
			Ports:     []corev1.ServicePort{{Port: 80}},
		},
	}
	client := kubefake.NewClientset(svc)
	manager := NewService(Dependencies{
		Common: common.Dependencies{
			KubernetesClient: client,
			Logger:           noopLogger{},
		},
	})

	details, err := manager.Services("default")
	require.NoError(t, err)
	require.Len(t, details, 1)
	require.Equal(t, "Unknown", details[0].HealthStatus) // no endpoint slices provided
}
