package network

import (
	"testing"
	"time"

	corev1 "k8s.io/api/core/v1"
	discoveryv1 "k8s.io/api/discovery/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/luxury-yacht/app/backend/resources/common"
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
