package service

import (
	"testing"

	corev1 "k8s.io/api/core/v1"
)

func TestObjectMapStatusVariants(t *testing.T) {
	tests := []struct {
		name             string
		service          corev1.Service
		wantState        string
		wantLabel        string
		wantPresentation string
	}{
		{
			name: "load balancer active",
			service: corev1.Service{
				Spec: corev1.ServiceSpec{Type: corev1.ServiceTypeLoadBalancer},
				Status: corev1.ServiceStatus{
					LoadBalancer: corev1.LoadBalancerStatus{
						Ingress: []corev1.LoadBalancerIngress{{IP: "192.0.2.10"}},
					},
				},
			},
			wantState:        "LoadBalancer",
			wantLabel:        "LoadBalancer active",
			wantPresentation: "ready",
		},
		{
			name:             "load balancer pending",
			service:          corev1.Service{Spec: corev1.ServiceSpec{Type: corev1.ServiceTypeLoadBalancer}},
			wantState:        "LoadBalancer",
			wantLabel:        "LoadBalancer pending",
			wantPresentation: "warning",
		},
		{
			name: "external name has no status indicator",
			service: corev1.Service{Spec: corev1.ServiceSpec{
				Type:         corev1.ServiceTypeExternalName,
				ExternalName: "example.com",
			}},
			wantState:        "ExternalName",
			wantLabel:        "ExternalName",
			wantPresentation: "ready",
		},
		{
			name:             "cluster ip reports source service type",
			service:          corev1.Service{Spec: corev1.ServiceSpec{Type: corev1.ServiceTypeClusterIP}},
			wantState:        "ClusterIP",
			wantLabel:        "ClusterIP",
			wantPresentation: "ready",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			status := ObjectMapStatus("cluster-a", tt.service)
			if status == nil || status.State != tt.wantState || status.Label != tt.wantLabel || status.Presentation != tt.wantPresentation {
				t.Fatalf("unexpected service status: got %#v, want state=%q label=%q presentation=%q", status, tt.wantState, tt.wantLabel, tt.wantPresentation)
			}
		})
	}
}
