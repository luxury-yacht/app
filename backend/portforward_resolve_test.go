package backend

import (
	"context"
	"testing"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	discoveryv1 "k8s.io/api/discovery/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/utils/ptr"

	"k8s.io/client-go/kubernetes/fake"
)

func testPortForwardTarget(kind, namespace, name string) portForwardTargetRef {
	group := ""
	version := "v1"
	if kind == "Deployment" || kind == "StatefulSet" || kind == "DaemonSet" {
		group = "apps"
	}
	return portForwardTargetRef{
		Namespace: namespace,
		Kind:      kind,
		Group:     group,
		Version:   version,
		Name:      name,
	}
}

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

	podName, err := resolvePodForTarget(context.Background(), client, testPortForwardTarget("Pod", "default", "my-pod"))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if podName != "my-pod" {
		t.Errorf("expected pod name 'my-pod', got '%s'", podName)
	}
}

func TestResolvePodForTarget_DeploymentUsesOwnedPods(t *testing.T) {
	deploymentUID := types.UID("deploy-uid")
	replicaSetUID := types.UID("rs-uid")
	controller := true

	client := fake.NewClientset(
		&appsv1.Deployment{
			ObjectMeta: metav1.ObjectMeta{
				Name:      "nginx",
				Namespace: "default",
				UID:       deploymentUID,
			},
			Spec: appsv1.DeploymentSpec{
				Selector: &metav1.LabelSelector{MatchLabels: map[string]string{"app": "nginx"}},
			},
		},
		&appsv1.Deployment{
			ObjectMeta: metav1.ObjectMeta{
				Name:      "nginx-worker",
				Namespace: "default",
				UID:       types.UID("other-deploy"),
			},
			Spec: appsv1.DeploymentSpec{
				Selector: &metav1.LabelSelector{MatchLabels: map[string]string{"app": "nginx-worker"}},
			},
		},
		&appsv1.ReplicaSet{
			ObjectMeta: metav1.ObjectMeta{
				Name:      "nginx-rs",
				Namespace: "default",
				UID:       replicaSetUID,
				Labels:    map[string]string{"app": "nginx"},
				OwnerReferences: []metav1.OwnerReference{{
					APIVersion: "apps/v1",
					Kind:       "Deployment",
					Name:       "nginx",
					UID:        deploymentUID,
					Controller: &controller,
				}},
			},
			Spec: appsv1.ReplicaSetSpec{
				Selector: &metav1.LabelSelector{MatchLabels: map[string]string{"app": "nginx"}},
			},
		},
		&appsv1.ReplicaSet{
			ObjectMeta: metav1.ObjectMeta{
				Name:      "nginx-worker-rs",
				Namespace: "default",
				UID:       types.UID("other-rs"),
				Labels:    map[string]string{"app": "nginx-worker"},
				OwnerReferences: []metav1.OwnerReference{{
					APIVersion: "apps/v1",
					Kind:       "Deployment",
					Name:       "nginx-worker",
					UID:        types.UID("other-deploy"),
					Controller: &controller,
				}},
			},
			Spec: appsv1.ReplicaSetSpec{
				Selector: &metav1.LabelSelector{MatchLabels: map[string]string{"app": "nginx-worker"}},
			},
		},
		&corev1.Pod{
			ObjectMeta: metav1.ObjectMeta{
				Name:      "nginx-abc123",
				Namespace: "default",
				Labels:    map[string]string{"app": "nginx"},
				OwnerReferences: []metav1.OwnerReference{{
					APIVersion: "apps/v1",
					Kind:       "ReplicaSet",
					Name:       "nginx-rs",
					UID:        replicaSetUID,
					Controller: &controller,
				}},
			},
			Status: corev1.PodStatus{
				Phase: corev1.PodRunning,
				Conditions: []corev1.PodCondition{
					{Type: corev1.PodReady, Status: corev1.ConditionTrue},
				},
			},
		},
		&corev1.Pod{
			ObjectMeta: metav1.ObjectMeta{
				Name:      "nginx-worker-abc123",
				Namespace: "default",
				Labels:    map[string]string{"app": "nginx-worker"},
			},
			Status: corev1.PodStatus{
				Phase: corev1.PodRunning,
				Conditions: []corev1.PodCondition{
					{Type: corev1.PodReady, Status: corev1.ConditionTrue},
				},
			},
		},
	)

	podName, err := resolvePodForTarget(context.Background(), client, testPortForwardTarget("Deployment", "default", "nginx"))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if podName != "nginx-abc123" {
		t.Errorf("expected owned pod 'nginx-abc123', got '%s'", podName)
	}
}

func TestResolvePodForTarget_StatefulSet(t *testing.T) {
	controller := true
	client := fake.NewClientset(
		&appsv1.StatefulSet{
			ObjectMeta: metav1.ObjectMeta{
				Name:      "mysql",
				Namespace: "database",
				UID:       types.UID("mysql-uid"),
			},
			Spec: appsv1.StatefulSetSpec{
				Selector: &metav1.LabelSelector{MatchLabels: map[string]string{"app": "mysql"}},
			},
		},
		&corev1.Pod{
			ObjectMeta: metav1.ObjectMeta{
				Name:      "mysql-0",
				Namespace: "database",
				Labels:    map[string]string{"app": "mysql"},
				OwnerReferences: []metav1.OwnerReference{{
					APIVersion: "apps/v1",
					Kind:       "StatefulSet",
					Name:       "mysql",
					UID:        types.UID("mysql-uid"),
					Controller: &controller,
				}},
			},
			Status: corev1.PodStatus{
				Phase: corev1.PodRunning,
				Conditions: []corev1.PodCondition{
					{Type: corev1.PodReady, Status: corev1.ConditionTrue},
				},
			},
		},
	)

	podName, err := resolvePodForTarget(context.Background(), client, testPortForwardTarget("StatefulSet", "database", "mysql"))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if podName != "mysql-0" {
		t.Errorf("expected pod name 'mysql-0', got '%s'", podName)
	}
}

func TestResolvePodForTarget_DaemonSet(t *testing.T) {
	controller := true
	client := fake.NewClientset(
		&appsv1.DaemonSet{
			ObjectMeta: metav1.ObjectMeta{
				Name:      "fluentd",
				Namespace: "kube-system",
				UID:       types.UID("fluentd-uid"),
			},
			Spec: appsv1.DaemonSetSpec{
				Selector: &metav1.LabelSelector{MatchLabels: map[string]string{"app": "fluentd"}},
			},
		},
		&corev1.Pod{
			ObjectMeta: metav1.ObjectMeta{
				Name:      "fluentd-xyz99",
				Namespace: "kube-system",
				Labels:    map[string]string{"app": "fluentd"},
				OwnerReferences: []metav1.OwnerReference{{
					APIVersion: "apps/v1",
					Kind:       "DaemonSet",
					Name:       "fluentd",
					UID:        types.UID("fluentd-uid"),
					Controller: &controller,
				}},
			},
			Status: corev1.PodStatus{
				Phase: corev1.PodRunning,
				Conditions: []corev1.PodCondition{
					{Type: corev1.PodReady, Status: corev1.ConditionTrue},
				},
			},
		},
	)

	podName, err := resolvePodForTarget(context.Background(), client, testPortForwardTarget("DaemonSet", "kube-system", "fluentd"))
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

	_, err := resolvePodForTarget(context.Background(), client, testPortForwardTarget("Pod", "default", "my-pod"))
	if err == nil {
		t.Error("expected error for non-ready pod")
	}
}

// TestResolvePodForTarget_PodNotFound verifies that a non-existent pod returns an error.
func TestResolvePodForTarget_PodNotFound(t *testing.T) {
	client := fake.NewClientset()

	_, err := resolvePodForTarget(context.Background(), client, testPortForwardTarget("Pod", "default", "nonexistent"))
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

	podName, err := resolvePodForTarget(context.Background(), client, testPortForwardTarget("Service", "default", "my-service"))
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

	_, err := resolvePodForTarget(context.Background(), client, testPortForwardTarget("Service", "default", "my-service"))
	if err == nil {
		t.Error("expected error when service has no ready pods")
	}
}

// TestResolvePodForTarget_ServiceNotFound verifies error when service does not exist.
func TestResolvePodForTarget_ServiceNotFound(t *testing.T) {
	client := fake.NewClientset()

	_, err := resolvePodForTarget(context.Background(), client, testPortForwardTarget("Service", "default", "nonexistent"))
	if err == nil {
		t.Error("expected error for non-existent service")
	}
}

// TestResolvePodForTarget_UnsupportedKind verifies that unsupported kinds return an error.
func TestResolvePodForTarget_UnsupportedKind(t *testing.T) {
	client := fake.NewClientset()

	_, err := resolvePodForTarget(context.Background(), client, portForwardTargetRef{
		Namespace: "default",
		Kind:      "ConfigMap",
		Group:     "",
		Version:   "v1",
		Name:      "my-cm",
	})
	if err == nil {
		t.Error("expected error for unsupported kind")
	}
}

// TestResolvePodForTarget_WorkloadNoReadyPod verifies error when workload has no ready pods.
func TestResolvePodForTarget_WorkloadNoReadyPod(t *testing.T) {
	controller := true
	client := fake.NewClientset(
		&appsv1.Deployment{
			ObjectMeta: metav1.ObjectMeta{
				Name:      "nginx",
				Namespace: "default",
				UID:       types.UID("deploy-uid"),
			},
			Spec: appsv1.DeploymentSpec{
				Selector: &metav1.LabelSelector{MatchLabels: map[string]string{"app": "nginx"}},
			},
		},
		&appsv1.ReplicaSet{
			ObjectMeta: metav1.ObjectMeta{
				Name:      "nginx-rs",
				Namespace: "default",
				UID:       types.UID("rs-uid"),
				Labels:    map[string]string{"app": "nginx"},
				OwnerReferences: []metav1.OwnerReference{{
					APIVersion: "apps/v1",
					Kind:       "Deployment",
					Name:       "nginx",
					UID:        types.UID("deploy-uid"),
					Controller: &controller,
				}},
			},
			Spec: appsv1.ReplicaSetSpec{
				Selector: &metav1.LabelSelector{MatchLabels: map[string]string{"app": "nginx"}},
			},
		},
		&corev1.Pod{
			ObjectMeta: metav1.ObjectMeta{
				Name:      "nginx-abc123",
				Namespace: "default",
				Labels:    map[string]string{"app": "nginx"},
				OwnerReferences: []metav1.OwnerReference{{
					APIVersion: "apps/v1",
					Kind:       "ReplicaSet",
					Name:       "nginx-rs",
					UID:        types.UID("rs-uid"),
					Controller: &controller,
				}},
			},
			Status: corev1.PodStatus{
				Phase: corev1.PodPending,
			},
		},
	)

	_, err := resolvePodForTarget(context.Background(), client, testPortForwardTarget("Deployment", "default", "nginx"))
	if err == nil {
		t.Error("expected error when deployment has no ready pods")
	}
}

// TestResolvePodForTarget_WorkloadNoPods verifies error when workload has no matching pods.
func TestResolvePodForTarget_WorkloadNoPods(t *testing.T) {
	client := fake.NewClientset(&appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "nginx",
			Namespace: "default",
			UID:       types.UID("deploy-uid"),
		},
		Spec: appsv1.DeploymentSpec{
			Selector: &metav1.LabelSelector{MatchLabels: map[string]string{"app": "nginx"}},
		},
	})

	_, err := resolvePodForTarget(context.Background(), client, testPortForwardTarget("Deployment", "default", "nginx"))
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
