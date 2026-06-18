package pods

import (
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
)

func TestBuildResourceModelStatus(t *testing.T) {
	deletingAt := metav1.NewTime(time.Date(2026, time.May, 7, 21, 15, 0, 0, time.UTC))

	tests := []struct {
		name             string
		pod              *corev1.Pod
		wantLabel        string
		wantState        string
		wantPresentation string
		wantReason       string
	}{
		{
			name:             "running ready",
			pod:              podWithRegularContainer(corev1.PodRunning, true, corev1.ContainerState{Running: &corev1.ContainerStateRunning{}}),
			wantLabel:        "Running",
			wantState:        "Running",
			wantPresentation: "ready",
		},
		{
			name:             "running readiness mismatch",
			pod:              podWithRegularContainer(corev1.PodRunning, false, corev1.ContainerState{Running: &corev1.ContainerStateRunning{}}),
			wantLabel:        "Running",
			wantState:        "Running",
			wantPresentation: "warning",
		},
		{
			name:             "pending container creating",
			pod:              podWithRegularContainer(corev1.PodPending, false, corev1.ContainerState{Waiting: &corev1.ContainerStateWaiting{Reason: "ContainerCreating"}}),
			wantLabel:        "ContainerCreating",
			wantState:        "Pending",
			wantPresentation: "warning",
			wantReason:       "ContainerCreating",
		},
		{
			name: "failed evicted",
			pod: func() *corev1.Pod {
				pod := podWithRegularContainer(corev1.PodFailed, false, corev1.ContainerState{})
				pod.Status.Reason = "Evicted"
				return pod
			}(),
			wantLabel:        "Evicted",
			wantState:        "Failed",
			wantPresentation: "error",
			wantReason:       "Evicted",
		},
		{
			name: "init crashloop",
			pod: func() *corev1.Pod {
				pod := basePod(corev1.PodPending)
				pod.Status.InitContainerStatuses = []corev1.ContainerStatus{{
					Name:  "init",
					State: corev1.ContainerState{Waiting: &corev1.ContainerStateWaiting{Reason: "CrashLoopBackOff"}},
				}}
				return pod
			}(),
			wantLabel:        "Init:CrashLoopBackOff",
			wantState:        "Pending",
			wantPresentation: "error",
			wantReason:       "CrashLoopBackOff",
		},
		{
			name:             "image pull",
			pod:              podWithRegularContainer(corev1.PodPending, false, corev1.ContainerState{Waiting: &corev1.ContainerStateWaiting{Reason: "ErrImagePull"}}),
			wantLabel:        "ErrImagePull",
			wantState:        "Pending",
			wantPresentation: "error",
			wantReason:       "ErrImagePull",
		},
		{
			name:             "succeeded completed",
			pod:              podWithRegularContainer(corev1.PodSucceeded, false, corev1.ContainerState{Terminated: &corev1.ContainerStateTerminated{Reason: "Completed"}}),
			wantLabel:        "Completed",
			wantState:        "Succeeded",
			wantPresentation: "ready",
			wantReason:       "Completed",
		},
		{
			name: "terminating overrides waiting container reason and preserves source phase",
			pod: func() *corev1.Pod {
				pod := podWithRegularContainer(corev1.PodRunning, false, corev1.ContainerState{Waiting: &corev1.ContainerStateWaiting{Reason: "CrashLoopBackOff"}})
				pod.DeletionTimestamp = &deletingAt
				return pod
			}(),
			wantLabel:        "Terminating",
			wantState:        "Running",
			wantPresentation: "terminating",
			wantReason:       "DeletionTimestamp",
		},
		{
			name:             "unknown",
			pod:              basePod(""),
			wantLabel:        "Unknown",
			wantState:        "Unknown",
			wantPresentation: "unknown",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			model := BuildResourceModel("cluster-a", tt.pod)
			require.Equal(t, "cluster-a", model.Ref.ClusterID)
			require.Equal(t, "", model.Ref.Group)
			require.Equal(t, "v1", model.Ref.Version)
			require.Equal(t, "Pod", model.Ref.Kind)
			require.Equal(t, "pods", model.Ref.Resource)
			require.Equal(t, "default", model.Ref.Namespace)
			require.Equal(t, "pod-1", model.Ref.Name)
			require.Equal(t, tt.wantLabel, model.Status.Label)
			require.Equal(t, tt.wantState, model.Status.State)
			require.Equal(t, tt.wantPresentation, model.Status.Presentation)
			require.Equal(t, tt.wantReason, model.Status.Reason)
		})
	}
}

func TestBuildFactsUseSpecContainersAsReadinessDenominator(t *testing.T) {
	pod := basePod(corev1.PodRunning)
	pod.Spec.Containers = []corev1.Container{{Name: "app"}, {Name: "sidecar"}}
	pod.Status.ContainerStatuses = []corev1.ContainerStatus{{
		Name:         "app",
		Ready:        true,
		RestartCount: 2,
		State:        corev1.ContainerState{Running: &corev1.ContainerStateRunning{}},
	}}
	pod.Status.InitContainerStatuses = []corev1.ContainerStatus{{Name: "init", RestartCount: 1}}

	facts := BuildFacts(pod)
	require.Equal(t, int32(1), facts.ReadyContainers)
	require.Equal(t, int32(2), facts.TotalContainers)
	require.Equal(t, int32(3), facts.RestartCount)

	model := BuildResourceModel("cluster-a", pod)
	require.Equal(t, "warning", model.Status.Presentation)
	require.Contains(t, model.Status.Signals, resourcemodel.ResourceStatusSignal{
		Type:   resourcemodel.StatusSignalReadiness,
		Name:   "containers",
		Status: "1/2",
	})
}

func TestBuildResourceModelCopiesMetadata(t *testing.T) {
	pod := basePod(corev1.PodRunning)
	pod.UID = types.UID("uid-1")
	pod.Labels = map[string]string{"app": "demo"}
	pod.Annotations = map[string]string{"note": "test"}
	pod.Finalizers = []string{"example.com/finalizer"}

	model := BuildResourceModel("cluster-a", pod)
	require.Equal(t, "uid-1", model.Ref.UID)
	require.Equal(t, map[string]string{"app": "demo"}, model.Metadata.Labels)
	require.Equal(t, map[string]string{"note": "test"}, model.Metadata.Annotations)
	require.Equal(t, []string{"example.com/finalizer"}, model.Metadata.Finalizers)

	pod.Labels["app"] = "changed"
	require.Equal(t, "demo", model.Metadata.Labels["app"])
}

func basePod(phase corev1.PodPhase) *corev1.Pod {
	return &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "pod-1",
			Namespace: "default",
		},
		Spec: corev1.PodSpec{
			Containers: []corev1.Container{{Name: "app"}},
		},
		Status: corev1.PodStatus{Phase: phase},
	}
}

func podWithRegularContainer(phase corev1.PodPhase, ready bool, state corev1.ContainerState) *corev1.Pod {
	pod := basePod(phase)
	pod.Status.ContainerStatuses = []corev1.ContainerStatus{{
		Name:  "app",
		Ready: ready,
		State: state,
	}}
	return pod
}
