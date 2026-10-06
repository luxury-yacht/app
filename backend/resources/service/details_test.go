/*
 * backend/resources/service/details_test.go
 *
 * Tests for the Service detail service (co-located with the kind).
 */

package service

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	discoveryv1 "k8s.io/api/discovery/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/util/intstr"
	"k8s.io/client-go/kubernetes/fake"
	k8stesting "k8s.io/client-go/testing"

	"github.com/luxury-yacht/app/backend/internal/applog"
	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/luxury-yacht/app/backend/testsupport"
)

func newService(t testing.TB, client *fake.Clientset) *Service {
	t.Helper()
	deps := testsupport.NewResourceDependencies(
		testsupport.WithDepsKubeClient(client),
		testsupport.WithDepsLogger(applog.Noop),
	)
	return NewService(deps)
}

func ptrToInt32(v int32) *int32 { return &v }

func intstrFromInt(v int) intstr.IntOrString { return intstr.FromInt(v) }

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

	m := NewService(common.Dependencies{})
	detail := m.buildServiceDetails(lbSvc, withSlices)
	if detail.HealthStatus != "Healthy" || detail.LoadBalancerStatus != "Active" || detail.LoadBalancerIP != "1.2.3.4" {
		t.Fatalf("unexpected load balancer detail: %+v", detail)
	}
	require.Equal(t, "LoadBalancer active", detail.Status)
	require.Equal(t, "LoadBalancer", detail.StatusState)
	require.Equal(t, "ready", detail.StatusPresentation)
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
	require.Equal(t, "ExternalName", extDetail.Status)
	require.Equal(t, "ready", extDetail.StatusPresentation)
	if extDetail.ExternalName != "example.com" {
		t.Fatalf("expected external name to be set, got %s", extDetail.ExternalName)
	}

	noSliceDetail := m.buildServiceDetails(lbSvc, nil)
	if noSliceDetail.HealthStatus != "Unknown" {
		t.Fatalf("expected Unknown health when endpoint slices missing, got %s", noSliceDetail.HealthStatus)
	}
}

func TestManagerServiceDetails(t *testing.T) {
	svc := &corev1.Service{
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
				discoveryv1.LabelServiceName: svc.Name,
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

	client := fake.NewClientset(svc, slice)
	manager := newService(t, client)

	detail, err := manager.GetService(context.Background(), "default", "web")
	require.NoError(t, err)
	require.Equal(t, "Service", detail.Kind)
	require.Equal(t, "Healthy", detail.HealthStatus)
	require.Equal(t, "LoadBalancer", detail.ServiceType)
	require.Equal(t, "10.0.0.1", detail.ClusterIP)
	require.Contains(t, detail.Endpoints, "10.2.0.5:8080")
	require.Equal(t, "Active", detail.LoadBalancerStatus)
}

func TestManagerServiceErrorWhenGetFails(t *testing.T) {
	client := fake.NewClientset()
	client.PrependReactor("get", "services", func(action k8stesting.Action) (bool, runtime.Object, error) {
		return true, nil, fmt.Errorf("boom")
	})

	manager := newService(t, client)

	_, err := manager.GetService(context.Background(), "default", "web")
	require.Error(t, err)
	require.Contains(t, err.Error(), "failed to get service")
}

func TestManagerServicesHandlesEndpointListError(t *testing.T) {
	svc := &corev1.Service{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "web",
			Namespace: "default",
		},
		Spec: corev1.ServiceSpec{
			Type:      corev1.ServiceTypeClusterIP,
			ClusterIP: "10.0.0.1",
		},
	}

	client := fake.NewClientset(svc)
	client.PrependReactor("list", "endpointslices", func(action k8stesting.Action) (bool, runtime.Object, error) {
		return true, nil, fmt.Errorf("endpoint slices down")
	})

	manager := newService(t, client)

	detail, err := manager.GetService(context.Background(), "default", "web")
	require.NoError(t, err)
	require.Equal(t, "Unknown", detail.HealthStatus)
	require.Contains(t, detail.Details, "ClusterIP")
}

func TestManagerServicesReflectsPendingLoadBalancer(t *testing.T) {
	svc := &corev1.Service{
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

	client := fake.NewClientset(svc)
	manager := newService(t, client)

	detail, err := manager.GetService(context.Background(), "default", "lb-web")
	require.NoError(t, err)
	require.Equal(t, "Pending", detail.LoadBalancerStatus)
	require.Equal(t, "", detail.LoadBalancerIP)
	require.Contains(t, detail.Details, "LoadBalancer")
}

func TestManagerServicesLoadBalancerActiveWhenIngressPresent(t *testing.T) {
	svc := &corev1.Service{
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
				discoveryv1.LabelServiceName: svc.Name,
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

	client := fake.NewClientset(svc, slice)
	manager := newService(t, client)

	detail, err := manager.GetService(context.Background(), "default", "lb-active")
	require.NoError(t, err)
	require.Equal(t, "Active", detail.LoadBalancerStatus)
	require.Equal(t, "lb.example.com", detail.LoadBalancerIP)
	require.Equal(t, "Healthy", detail.HealthStatus)
}

func TestManagerServiceErrors(t *testing.T) {
	client := fake.NewClientset()
	client.PrependReactor("get", "services", func(k8stesting.Action) (bool, runtime.Object, error) {
		return true, nil, fmt.Errorf("boom")
	})

	manager := NewService(common.Dependencies{
		KubernetesClient: client,
		Logger:           applog.Noop,
	})

	_, err := manager.GetService(context.Background(), "default", "web")
	require.Error(t, err)
}

// The Overview counts the pods behind a Service: ready and not-ready addresses, not the
// address-per-port entries of the Endpoints list.
func TestServiceDetailsCountReadyAddressesNotPortEntries(t *testing.T) {
	svc := &corev1.Service{
		ObjectMeta: metav1.ObjectMeta{Name: "web", Namespace: "shop"},
		Spec: corev1.ServiceSpec{
			Type:      corev1.ServiceTypeClusterIP,
			ClusterIP: "10.0.0.5",
			Ports:     []corev1.ServicePort{{Name: "http", Port: 80}, {Name: "metrics", Port: 9090}},
		},
	}
	httpPort, metricsPort := int32(8080), int32(9090)
	ready, notReady := true, false
	endpoint := func(address string, isReady *bool) discoveryv1.Endpoint {
		return discoveryv1.Endpoint{Addresses: []string{address}, Conditions: discoveryv1.EndpointConditions{Ready: isReady}}
	}
	slices := []*discoveryv1.EndpointSlice{{
		ObjectMeta: metav1.ObjectMeta{Name: "web-abc"},
		Ports:      []discoveryv1.EndpointPort{{Port: &httpPort}, {Port: &metricsPort}},
		Endpoints: []discoveryv1.Endpoint{
			endpoint("10.1.0.1", &ready),
			endpoint("10.1.0.2", &ready),
			endpoint("10.1.0.3", &ready),
			endpoint("10.1.0.4", &notReady),
		},
	}}

	detail := NewService(common.Dependencies{}).buildServiceDetails(svc, slices)
	require.Len(t, detail.Endpoints, 6)
	require.Equal(t, 3, *detail.ReadyEndpointCount)
	require.Equal(t, 1, *detail.NotReadyEndpointCount)
}

// A Service whose endpoint list is known to be empty needs attention; when the list could not be
// read, the status must not claim anything about endpoints.
func TestServiceStatusWarnsWhenEndpointsAreKnownEmpty(t *testing.T) {
	svc := &corev1.Service{
		ObjectMeta: metav1.ObjectMeta{Name: "web", Namespace: "shop"},
		Spec: corev1.ServiceSpec{
			Type:      corev1.ServiceTypeClusterIP,
			ClusterIP: "10.0.0.5",
			Selector:  map[string]string{"app": "web"},
			Ports:     []corev1.ServicePort{{Name: "http", Port: 80}},
		},
	}
	m := NewService(common.Dependencies{})

	known := m.buildServiceDetails(svc, []*discoveryv1.EndpointSlice{})
	require.Equal(t, "ClusterIP, no endpoints", known.Status)
	require.Equal(t, "warning", known.StatusPresentation)

	unknown := m.buildServiceDetails(svc, nil)
	require.Equal(t, "ClusterIP", unknown.Status)
	require.Equal(t, "ready", unknown.StatusPresentation)
}

// A headless Service may define no ports, so its slices carry none; their ready addresses still
// count, and the Service must not be reported as having no endpoints.
func TestServiceDetailsCountPortlessEndpoints(t *testing.T) {
	svc := &corev1.Service{
		ObjectMeta: metav1.ObjectMeta{Name: "db", Namespace: "data"},
		Spec: corev1.ServiceSpec{
			Type:      corev1.ServiceTypeClusterIP,
			ClusterIP: corev1.ClusterIPNone,
			Selector:  map[string]string{"app": "db"},
		},
	}
	ready := true
	slices := []*discoveryv1.EndpointSlice{{
		ObjectMeta: metav1.ObjectMeta{Name: "db-abc"},
		Endpoints: []discoveryv1.Endpoint{
			{Addresses: []string{"10.1.0.9"}, Conditions: discoveryv1.EndpointConditions{Ready: &ready}},
		},
	}}

	detail := NewService(common.Dependencies{}).buildServiceDetails(svc, slices)
	require.Equal(t, "ClusterIP, 1 endpoint", detail.Status)
	require.Equal(t, []string{"10.1.0.9"}, detail.Endpoints)
	require.NotNil(t, detail.ReadyEndpointCount)
	require.Equal(t, 1, *detail.ReadyEndpointCount)
}

// When the EndpointSlices cannot be listed, readiness is unknown rather than zero.
func TestServiceDetailsLeaveReadinessUnknownWhenSlicesUnavailable(t *testing.T) {
	svc := &corev1.Service{
		ObjectMeta: metav1.ObjectMeta{Name: "web", Namespace: "shop"},
		Spec:       corev1.ServiceSpec{Type: corev1.ServiceTypeClusterIP, ClusterIP: "10.0.0.5"},
	}
	m := NewService(common.Dependencies{})

	unknown := m.buildServiceDetails(svc, nil)
	require.Nil(t, unknown.ReadyEndpointCount)
	require.Nil(t, unknown.NotReadyEndpointCount)

	known := m.buildServiceDetails(svc, []*discoveryv1.EndpointSlice{})
	require.NotNil(t, known.ReadyEndpointCount)
	require.Equal(t, 0, *known.ReadyEndpointCount)
}
