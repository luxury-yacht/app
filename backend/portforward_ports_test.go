package backend

import (
	"context"
	"testing"

	corev1 "k8s.io/api/core/v1"
	discoveryv1 "k8s.io/api/discovery/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/util/intstr"
	"k8s.io/utils/ptr"

	"k8s.io/client-go/kubernetes/fake"
)

func TestCollectPodPorts_OnlyTCPUnique(t *testing.T) {
	pod := &corev1.Pod{
		Spec: corev1.PodSpec{
			Containers: []corev1.Container{
				{
					Ports: []corev1.ContainerPort{
						{ContainerPort: 8080, Name: "http"},
						{ContainerPort: 53, Protocol: corev1.ProtocolUDP, Name: "dns"},
					},
				},
				{
					Ports: []corev1.ContainerPort{
						{ContainerPort: 8080, Name: "metrics"},
					},
				},
			},
		},
	}

	ports := collectPodPorts(pod)
	if len(ports) != 1 {
		t.Fatalf("expected 1 TCP port, got %d", len(ports))
	}
	if ports[0].Port != 8080 || ports[0].Protocol != "TCP" {
		t.Fatalf("unexpected port info: %+v", ports[0])
	}
}

func TestResolvePortForwardDestination_ServiceMapsServicePortToPodTargetPort(t *testing.T) {
	client := fake.NewClientset(
		&corev1.Service{
			ObjectMeta: metav1.ObjectMeta{
				Name:      "api",
				Namespace: "default",
			},
			Spec: corev1.ServiceSpec{
				Ports: []corev1.ServicePort{{
					Name:       "http",
					Port:       80,
					TargetPort: intstr.FromString("http"),
				}},
			},
		},
		&discoveryv1.EndpointSlice{
			ObjectMeta: metav1.ObjectMeta{
				Name:      "api-1",
				Namespace: "default",
				Labels: map[string]string{
					discoveryv1.LabelServiceName: "api",
				},
			},
			Endpoints: []discoveryv1.Endpoint{{
				Conditions: discoveryv1.EndpointConditions{
					Ready: ptr.To(true),
				},
				TargetRef: &corev1.ObjectReference{
					Kind: "Pod",
					Name: "api-pod",
				},
			}},
		},
		&corev1.Pod{
			ObjectMeta: metav1.ObjectMeta{
				Name:      "api-pod",
				Namespace: "default",
			},
			Spec: corev1.PodSpec{
				Containers: []corev1.Container{{
					Ports: []corev1.ContainerPort{{
						Name:          "http",
						ContainerPort: 8080,
					}},
				}},
			},
			Status: corev1.PodStatus{
				Phase: corev1.PodRunning,
				Conditions: []corev1.PodCondition{{
					Type:   corev1.PodReady,
					Status: corev1.ConditionTrue,
				}},
			},
		},
	)

	resolved, err := resolvePortForwardDestination(context.Background(), client, portForwardTargetRef{
		Namespace: "default",
		Kind:      "Service",
		Group:     "",
		Version:   "v1",
		Name:      "api",
	}, 80)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if resolved.PodName != "api-pod" {
		t.Fatalf("expected pod api-pod, got %s", resolved.PodName)
	}
	if resolved.ForwardPort != 8080 {
		t.Fatalf("expected pod port 8080, got %d", resolved.ForwardPort)
	}
}

func TestGetTargetPorts_ServiceUsesServicePortsAndFiltersNonTCP(t *testing.T) {
	app := newTestAppWithDefaults(t)
	app.Ctx = context.Background()
	app.clusterClients = map[string]*clusterClients{
		portForwardClusterID: {
			meta:              ClusterMeta{ID: portForwardClusterID, Name: "ctx"},
			kubeconfigPath:    "/path",
			kubeconfigContext: "ctx",
			client: fake.NewClientset(&corev1.Service{
				ObjectMeta: metav1.ObjectMeta{
					Name:      "api",
					Namespace: "default",
				},
				Spec: corev1.ServiceSpec{
					Ports: []corev1.ServicePort{
						{Name: "http", Port: 80},
						{Name: "dns", Port: 53, Protocol: corev1.ProtocolUDP},
					},
				},
			}),
		},
	}

	ports, err := app.GetTargetPorts(portForwardClusterID, "default", "Service", "", "v1", "api")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(ports) != 1 {
		t.Fatalf("expected 1 TCP service port, got %d", len(ports))
	}
	if ports[0].Port != 80 || ports[0].Name != "http" || ports[0].Protocol != "TCP" {
		t.Fatalf("unexpected service ports: %+v", ports)
	}
}
