package pods

import (
	"testing"

	corev1 "k8s.io/api/core/v1"
)

func TestObjectMapStatusRequiresAllContainersReady(t *testing.T) {
	readyContainer := func(name string) corev1.ContainerStatus {
		return corev1.ContainerStatus{
			Name:  name,
			Ready: true,
			State: corev1.ContainerState{Running: &corev1.ContainerStateRunning{}},
		}
	}
	runningContainer := func(name string) corev1.ContainerStatus {
		return corev1.ContainerStatus{
			Name:  name,
			Ready: false,
			State: corev1.ContainerState{Running: &corev1.ContainerStateRunning{}},
		}
	}

	tests := []struct {
		name             string
		pod              corev1.Pod
		wantState        string
		wantLabel        string
		wantPresentation string
	}{
		{
			name: "all regular containers ready",
			pod: corev1.Pod{
				Spec: corev1.PodSpec{Containers: []corev1.Container{
					{Name: "app"},
					{Name: "sidecar"},
				}},
				Status: corev1.PodStatus{
					Phase: corev1.PodRunning,
					ContainerStatuses: []corev1.ContainerStatus{
						readyContainer("app"),
						readyContainer("sidecar"),
					},
				},
			},
			wantState:        "Running",
			wantLabel:        "Running",
			wantPresentation: "ready",
		},
		{
			name: "running phase with unready running container",
			pod: corev1.Pod{
				Spec: corev1.PodSpec{Containers: []corev1.Container{
					{Name: "app"},
					{Name: "sidecar"},
				}},
				Status: corev1.PodStatus{
					Phase: corev1.PodRunning,
					ContainerStatuses: []corev1.ContainerStatus{
						readyContainer("app"),
						runningContainer("sidecar"),
					},
				},
			},
			wantState:        "Running",
			wantLabel:        "Running",
			wantPresentation: "warning",
		},
		{
			name: "running phase with missing container status",
			pod: corev1.Pod{
				Spec: corev1.PodSpec{Containers: []corev1.Container{
					{Name: "app"},
					{Name: "sidecar"},
				}},
				Status: corev1.PodStatus{
					Phase:             corev1.PodRunning,
					ContainerStatuses: []corev1.ContainerStatus{readyContainer("app")},
				},
			},
			wantState:        "Running",
			wantLabel:        "Running",
			wantPresentation: "warning",
		},
		{
			name: "running phase with no container statuses",
			pod: corev1.Pod{
				Spec:   corev1.PodSpec{Containers: []corev1.Container{{Name: "app"}}},
				Status: corev1.PodStatus{Phase: corev1.PodRunning},
			},
			wantState:        "Running",
			wantLabel:        "Running",
			wantPresentation: "warning",
		},
		{
			name: "startup container creation stays degraded",
			pod: corev1.Pod{
				Spec: corev1.PodSpec{Containers: []corev1.Container{{Name: "app"}}},
				Status: corev1.PodStatus{
					Phase: corev1.PodPending,
					ContainerStatuses: []corev1.ContainerStatus{{
						Name:  "app",
						State: corev1.ContainerState{Waiting: &corev1.ContainerStateWaiting{Reason: "ContainerCreating"}},
					}},
				},
			},
			wantState:        "Pending",
			wantLabel:        "ContainerCreating",
			wantPresentation: "warning",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			status := ObjectMapStatus("cluster-a", tt.pod)
			if status == nil || status.State != tt.wantState || status.Label != tt.wantLabel || status.Presentation != tt.wantPresentation {
				t.Fatalf("unexpected pod status: got %#v, want state=%q label=%q presentation=%q", status, tt.wantState, tt.wantLabel, tt.wantPresentation)
			}
		})
	}
}
