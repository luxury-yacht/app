package backend

import (
	"context"
	"testing"

	corev1 "k8s.io/api/core/v1"
	discoveryv1 "k8s.io/api/discovery/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes/fake"
	"k8s.io/utils/ptr"
)

// TestResolvePodForTarget_Pod verifies that a ready pod resolves to itself.
func TestResolvePodForTarget_Pod(t *testing.T) {
	client := fake.NewClientset(&corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "my-pod",
			Namespace: "default",
		},
		Status: corev1.PodStatus{
			Phase: corev1.PodRunning,
			Conditions: []corev1.PodCondition{
				{Type: corev1.PodReady, Status: corev1.ConditionTrue},
			},
		},
	})

	podName, err := resolvePodForTarget(context.Background(), client, "default", "Pod", "my-pod")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if podName != "my-pod" {
		t.Errorf("expected pod name 'my-pod', got '%s'", podName)
	}
}

// TestResolvePodForTarget_Deployment verifies that a deployment resolves to a ready pod with matching prefix.
func TestResolvePodForTarget_Deployment(t *testing.T) {
	client := fake.NewClientset(
		&corev1.Pod{
			ObjectMeta: metav1.ObjectMeta{
				Name:      "nginx-abc123",
				Namespace: "default",
				Labels:    map[string]string{"app": "nginx"},
			},
			Status: corev1.PodStatus{
				Phase: corev1.PodRunning,
				Conditions: []corev1.PodCondition{
					{Type: corev1.PodReady, Status: corev1.ConditionTrue},
				},
			},
		},
	)

	podName, err := resolvePodForTarget(context.Background(), client, "default", "Deployment", "nginx")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if podName != "nginx-abc123" {
		t.Errorf("expected pod name 'nginx-abc123', got '%s'", podName)
	}
}

// TestResolvePodForTarget_StatefulSet verifies that a statefulset resolves to a ready pod with matching prefix.
func TestResolvePodForTarget_StatefulSet(t *testing.T) {
	client := fake.NewClientset(
		&corev1.Pod{
			ObjectMeta: metav1.ObjectMeta{
				Name:      "mysql-0",
				Namespace: "database",
			},
			Status: corev1.PodStatus{
				Phase: corev1.PodRunning,
				Conditions: []corev1.PodCondition{
					{Type: corev1.PodReady, Status: corev1.ConditionTrue},
				},
			},
		},
	)

	podName, err := resolvePodForTarget(context.Background(), client, "database", "StatefulSet", "mysql")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if podName != "mysql-0" {
		t.Errorf("expected pod name 'mysql-0', got '%s'", podName)
	}
}

// TestResolvePodForTarget_DaemonSet verifies that a daemonset resolves to a ready pod with matching prefix.
func TestResolvePodForTarget_DaemonSet(t *testing.T) {
	client := fake.NewClientset(
		&corev1.Pod{
			ObjectMeta: metav1.ObjectMeta{
				Name:      "fluentd-xyz99",
				Namespace: "kube-system",
			},
			Status: corev1.PodStatus{
				Phase: corev1.PodRunning,
				Conditions: []corev1.PodCondition{
					{Type: corev1.PodReady, Status: corev1.ConditionTrue},
				},
			},
		},
	)

	podName, err := resolvePodForTarget(context.Background(), client, "kube-system", "DaemonSet", "fluentd")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if podName != "fluentd-xyz99" {
		t.Errorf("expected pod name 'fluentd-xyz99', got '%s'", podName)
	}
}

// TestResolvePodForTarget_PodNotReady verifies that a non-ready pod returns an error.
func TestResolvePodForTarget_PodNotReady(t *testing.T) {
	client := fake.NewClientset(&corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "my-pod",
			Namespace: "default",
		},
		Status: corev1.PodStatus{
			Phase: corev1.PodPending,
		},
	})

	_, err := resolvePodForTarget(context.Background(), client, "default", "Pod", "my-pod")
	if err == nil {
		t.Error("expected error for non-ready pod")
	}
}

// TestResolvePodForTarget_PodNotFound verifies that a non-existent pod returns an error.
func TestResolvePodForTarget_PodNotFound(t *testing.T) {
	client := fake.NewClientset()

	_, err := resolvePodForTarget(context.Background(), client, "default", "Pod", "nonexistent")
	if err == nil {
		t.Error("expected error for non-existent pod")
	}
}

// TestResolvePodForTarget_Service verifies that a service resolves to a ready pod from its endpoint slices.
func TestResolvePodForTarget_Service(t *testing.T) {
	client := fake.NewClientset(
		&discoveryv1.EndpointSlice{
			ObjectMeta: metav1.ObjectMeta{
				Name:      "my-service-abc12",
				Namespace: "default",
				Labels: map[string]string{
					discoveryv1.LabelServiceName: "my-service",
				},
			},
			Endpoints: []discoveryv1.Endpoint{
				{
					Addresses: []string{"10.0.0.1"},
					Conditions: discoveryv1.EndpointConditions{
						Ready: ptr.To(true),
					},
					TargetRef: &corev1.ObjectReference{
						Kind: "Pod",
						Name: "backend-pod",
					},
				},
			},
		},
		&corev1.Pod{
			ObjectMeta: metav1.ObjectMeta{
				Name:      "backend-pod",
				Namespace: "default",
			},
			Status: corev1.PodStatus{
				Phase: corev1.PodRunning,
				Conditions: []corev1.PodCondition{
					{Type: corev1.PodReady, Status: corev1.ConditionTrue},
				},
			},
		},
	)

	podName, err := resolvePodForTarget(context.Background(), client, "default", "Service", "my-service")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if podName != "backend-pod" {
		t.Errorf("expected pod name 'backend-pod', got '%s'", podName)
	}
}

// TestResolvePodForTarget_ServiceNoReadyPods verifies error when service endpoint slices have no ready pods.
func TestResolvePodForTarget_ServiceNoReadyPods(t *testing.T) {
	client := fake.NewClientset(
		&discoveryv1.EndpointSlice{
			ObjectMeta: metav1.ObjectMeta{
				Name:      "my-service-abc12",
				Namespace: "default",
				Labels: map[string]string{
					discoveryv1.LabelServiceName: "my-service",
				},
			},
			Endpoints: []discoveryv1.Endpoint{
				{
					Addresses: []string{"10.0.0.1"},
					Conditions: discoveryv1.EndpointConditions{
						Ready: ptr.To(true),
					},
					TargetRef: &corev1.ObjectReference{
						Kind: "Pod",
						Name: "backend-pod",
					},
				},
			},
		},
		&corev1.Pod{
			ObjectMeta: metav1.ObjectMeta{
				Name:      "backend-pod",
				Namespace: "default",
			},
			Status: corev1.PodStatus{
				Phase: corev1.PodPending,
			},
		},
	)

	_, err := resolvePodForTarget(context.Background(), client, "default", "Service", "my-service")
	if err == nil {
		t.Error("expected error when service has no ready pods")
	}
}

// TestResolvePodForTarget_ServiceNotFound verifies error when service does not exist.
func TestResolvePodForTarget_ServiceNotFound(t *testing.T) {
	client := fake.NewClientset()

	_, err := resolvePodForTarget(context.Background(), client, "default", "Service", "nonexistent")
	if err == nil {
		t.Error("expected error for non-existent service")
	}
}

// TestResolvePodForTarget_UnsupportedKind verifies that unsupported kinds return an error.
func TestResolvePodForTarget_UnsupportedKind(t *testing.T) {
	client := fake.NewClientset()

	_, err := resolvePodForTarget(context.Background(), client, "default", "ConfigMap", "my-cm")
	if err == nil {
		t.Error("expected error for unsupported kind")
	}
}

// TestResolvePodForTarget_WorkloadNoReadyPod verifies error when workload has no ready pods.
func TestResolvePodForTarget_WorkloadNoReadyPod(t *testing.T) {
	client := fake.NewClientset(
		&corev1.Pod{
			ObjectMeta: metav1.ObjectMeta{
				Name:      "nginx-abc123",
				Namespace: "default",
			},
			Status: corev1.PodStatus{
				Phase: corev1.PodPending,
			},
		},
	)

	_, err := resolvePodForTarget(context.Background(), client, "default", "Deployment", "nginx")
	if err == nil {
		t.Error("expected error when deployment has no ready pods")
	}
}

// TestResolvePodForTarget_WorkloadNoPods verifies error when workload has no matching pods.
func TestResolvePodForTarget_WorkloadNoPods(t *testing.T) {
	client := fake.NewClientset()

	_, err := resolvePodForTarget(context.Background(), client, "default", "Deployment", "nginx")
	if err == nil {
		t.Error("expected error when deployment has no pods")
	}
}

// TestIsPodReady verifies the pod readiness check logic.
func TestIsPodReady(t *testing.T) {
	tests := []struct {
		name     string
		pod      *corev1.Pod
		expected bool
	}{
		{
			name: "running and ready",
			pod: &corev1.Pod{
				Status: corev1.PodStatus{
					Phase: corev1.PodRunning,
					Conditions: []corev1.PodCondition{
						{Type: corev1.PodReady, Status: corev1.ConditionTrue},
					},
				},
			},
			expected: true,
		},
		{
			name: "running but not ready",
			pod: &corev1.Pod{
				Status: corev1.PodStatus{
					Phase: corev1.PodRunning,
					Conditions: []corev1.PodCondition{
						{Type: corev1.PodReady, Status: corev1.ConditionFalse},
					},
				},
			},
			expected: false,
		},
		{
			name: "pending phase",
			pod: &corev1.Pod{
				Status: corev1.PodStatus{
					Phase: corev1.PodPending,
				},
			},
			expected: false,
		},
		{
			name: "succeeded phase",
			pod: &corev1.Pod{
				Status: corev1.PodStatus{
					Phase: corev1.PodSucceeded,
				},
			},
			expected: false,
		},
		{
			name: "failed phase",
			pod: &corev1.Pod{
				Status: corev1.PodStatus{
					Phase: corev1.PodFailed,
				},
			},
			expected: false,
		},
		{
			name: "running with no ready condition",
			pod: &corev1.Pod{
				Status: corev1.PodStatus{
					Phase: corev1.PodRunning,
					Conditions: []corev1.PodCondition{
						{Type: corev1.PodScheduled, Status: corev1.ConditionTrue},
					},
				},
			},
			expected: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := isPodReady(tt.pod)
			if result != tt.expected {
				t.Errorf("isPodReady() = %v, expected %v", result, tt.expected)
			}
		})
	}
}
