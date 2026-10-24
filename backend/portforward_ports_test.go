package backend

import (
	"context"
	"reflect"
	"testing"

	"github.com/luxury-yacht/app/backend/resourcemodel"

	appsv1 "k8s.io/api/apps/v1"
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
					APIVersion: "v1",
					Kind:       "Pod",
					Name:       "api-pod",
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
	fixture := newResourceGatewayFixture()
	fixture.setCluster(portForwardClusterID, &clusterClients{
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
	})

	ports, err := fixture.gateway.GetTargetPorts(resourcemodel.ResourceRef{ClusterID: portForwardClusterID, Version: "v1", Kind: "Service", Namespace: "default", Name: "api"})
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

// The port-forward modal lists these ports for a workload, so they must come
// from the ready pod a forward would use: TCP only, each port once.
func TestGetTargetPorts_WorkloadUsesReadyPodContainerPorts(t *testing.T) {
	selector := &metav1.LabelSelector{MatchLabels: map[string]string{"app": "web"}}
	deployment := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{Name: "web", Namespace: "default", UID: "web-uid"},
		Spec:       appsv1.DeploymentSpec{Selector: selector},
	}
	replicaSet := &appsv1.ReplicaSet{
		ObjectMeta: metav1.ObjectMeta{
			Name: "web-rs", Namespace: "default", UID: "web-rs-uid", Labels: map[string]string{"app": "web"},
			OwnerReferences: []metav1.OwnerReference{{Kind: "Deployment", Name: "web", UID: "web-uid", Controller: ptr.To(true)}},
		},
	}
	pod := func(name string, ready bool, containers ...corev1.Container) *corev1.Pod {
		status := corev1.PodStatus{Phase: corev1.PodPending}
		if ready {
			status = corev1.PodStatus{
				Phase:      corev1.PodRunning,
				Conditions: []corev1.PodCondition{{Type: corev1.PodReady, Status: corev1.ConditionTrue}},
			}
		}
		return &corev1.Pod{
			ObjectMeta: metav1.ObjectMeta{
				Name: name, Namespace: "default", Labels: map[string]string{"app": "web"},
				OwnerReferences: []metav1.OwnerReference{{Kind: "ReplicaSet", Name: "web-rs", UID: "web-rs-uid"}},
			},
			Spec:   corev1.PodSpec{Containers: containers},
			Status: status,
		}
	}
	notReady := pod("web-0", false, corev1.Container{Name: "app", Ports: []corev1.ContainerPort{{Name: "old", ContainerPort: 7777}}})
	ready := pod("web-1", true,
		corev1.Container{Name: "app", Ports: []corev1.ContainerPort{
			{Name: "http", ContainerPort: 8080},
			{Name: "statsd", ContainerPort: 8125, Protocol: corev1.ProtocolUDP},
		}},
		corev1.Container{Name: "sidecar", Ports: []corev1.ContainerPort{
			{Name: "http-alt", ContainerPort: 8080, Protocol: corev1.ProtocolTCP},
			{Name: "admin", ContainerPort: 9000, Protocol: corev1.ProtocolTCP},
		}},
	)

	fixture := newResourceGatewayFixture()
	fixture.setCluster(portForwardClusterID, &clusterClients{
		meta:              ClusterMeta{ID: portForwardClusterID, Name: "ctx"},
		kubeconfigPath:    "/path",
		kubeconfigContext: "ctx",
		client:            fake.NewClientset(deployment, replicaSet, notReady, ready),
	})

	ports, err := fixture.gateway.GetTargetPorts(resourcemodel.ResourceRef{
		ClusterID: portForwardClusterID, Group: "apps", Version: "v1", Kind: "Deployment", Namespace: "default", Name: "web",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	want := []ContainerPortInfo{
		{Port: 8080, Name: "http", Protocol: "TCP"},
		{Port: 9000, Name: "admin", Protocol: "TCP"},
	}
	if !reflect.DeepEqual(ports, want) {
		t.Fatalf("ports = %+v, want %+v", ports, want)
	}
}

func TestGetTargetPortsValidatesTargetBeforeClusterClients(t *testing.T) {
	gateway := newResourceGatewayFixture().gateway

	tests := []struct {
		name    string
		args    []string
		wantErr string
	}{
		{
			name:    "namespace",
			args:    []string{"", "Service", "", "v1", "api"},
			wantErr: "namespace is required",
		},
		{
			name:    "kind",
			args:    []string{"default", "", "", "v1", "api"},
			wantErr: "target kind is required",
		},
		{
			name:    "name",
			args:    []string{"default", "Service", "", "v1", ""},
			wantErr: "target name is required",
		},
		{
			name:    "version",
			args:    []string{"default", "Service", "", "", "api"},
			wantErr: "target version is required",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			_, err := gateway.GetTargetPorts(resourcemodel.ResourceRef{
				ClusterID: "missing-cluster", Namespace: tc.args[0], Kind: tc.args[1], Group: tc.args[2], Version: tc.args[3], Name: tc.args[4],
			})
			if err == nil || err.Error() != tc.wantErr {
				t.Fatalf("expected %q, got %v", tc.wantErr, err)
			}
		})
	}
}

func TestGetTargetPortsRequiresKubernetesClient(t *testing.T) {
	fixture := newResourceGatewayFixture()
	fixture.setCluster(portForwardClusterID, &clusterClients{
		meta:              ClusterMeta{ID: portForwardClusterID, Name: "ctx"},
		kubeconfigPath:    "/path",
		kubeconfigContext: "ctx",
	})

	_, err := fixture.gateway.GetTargetPorts(resourcemodel.ResourceRef{ClusterID: portForwardClusterID, Version: "v1", Kind: "Service", Namespace: "default", Name: "api"})
	if err == nil || err.Error() != "kubernetes client not initialized" {
		t.Fatalf("expected client error, got %v", err)
	}
}
