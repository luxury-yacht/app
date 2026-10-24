package nodes

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/internal/applog"
	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/kubernetes/fake"
	cgotesting "k8s.io/client-go/testing"
	"k8s.io/utils/ptr"
)

// The node shell must create the same pod as `kubectl debug node/<name>
// --profile=sysadmin` (kubectl v0.37.1 generateNodeDebugPod plus the sysadmin
// profile), so cluster admins can reason about it with kubectl's semantics. Only
// the managed-by label names this app instead of kubectl.
func TestNewDebugPodMatchesKubectlSysadminNodeDebugPod(t *testing.T) {
	restore := debugPodNameSuffix
	debugPodNameSuffix = func(n int) string { return strings.Repeat("x", n) }
	t.Cleanup(func() { debugPodNameSuffix = restore })

	pod := NewDebugPod("worker-1", "busybox:latest", []string{"/bin/sh"})

	want := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "node-debugger-worker-1-xxxxx",
			Namespace: "default",
			Labels:    map[string]string{"app.kubernetes.io/managed-by": "luxury-yacht"},
		},
		Spec: corev1.PodSpec{
			Containers: []corev1.Container{{
				Name:                     "debugger",
				Image:                    "busybox:latest",
				Command:                  []string{"/bin/sh"},
				Stdin:                    true,
				TTY:                      true,
				TerminationMessagePolicy: corev1.TerminationMessageReadFile,
				SecurityContext:          &corev1.SecurityContext{Privileged: ptr.To(true)},
				VolumeMounts:             []corev1.VolumeMount{{Name: "host-root", MountPath: "/host"}},
			}},
			NodeName:      "worker-1",
			RestartPolicy: corev1.RestartPolicyNever,
			Tolerations:   []corev1.Toleration{{Operator: corev1.TolerationOpExists}},
			HostNetwork:   true,
			HostPID:       true,
			HostIPC:       true,
			Volumes: []corev1.Volume{{
				Name:         "host-root",
				VolumeSource: corev1.VolumeSource{HostPath: &corev1.HostPathVolumeSource{Path: "/"}},
			}},
		},
	}
	require.Equal(t, want, pod)
}

// Without a command kubectl leaves the container command unset so the image's
// default entrypoint runs; the node shell does the same.
func TestNewDebugPodWithoutCommandUsesImageEntrypoint(t *testing.T) {
	pod := NewDebugPod("worker-1", "busybox:latest", nil)

	require.Nil(t, pod.Spec.Containers[0].Command)
	require.True(t, strings.HasPrefix(pod.Name, "node-debugger-worker-1-"))
	require.Len(t, strings.TrimPrefix(pod.Name, "node-debugger-worker-1-"), 5)
}

// fastDebugPodPolling shortens the start wait so failure paths finish quickly.
func fastDebugPodPolling(t *testing.T, timeout time.Duration) {
	t.Helper()
	interval, start := debugPodPollInterval, debugPodStartTimeout
	debugPodPollInterval, debugPodStartTimeout = time.Millisecond, timeout
	t.Cleanup(func() { debugPodPollInterval, debugPodStartTimeout = interval, start })
}

// debugPodService serves pod reads from the given statuses in order, repeating
// the last one, the way kubelet moves a debug pod through its states.
func debugPodService(t *testing.T, statuses ...corev1.PodStatus) *Service {
	t.Helper()
	pod := &corev1.Pod{ObjectMeta: metav1.ObjectMeta{Namespace: DebugPodNamespace, Name: "node-debugger-worker-1-abcde"}}
	client := fake.NewClientset(pod)
	reads := 0
	client.PrependReactor("get", "pods", func(cgotesting.Action) (bool, runtime.Object, error) {
		current := pod.DeepCopy()
		current.Status = statuses[min(reads, len(statuses)-1)]
		reads++
		return true, current, nil
	})
	return NewService(common.Dependencies{Logger: applog.Noop, KubernetesClient: client})
}

func debuggerStatus(state corev1.ContainerState) corev1.PodStatus {
	return corev1.PodStatus{
		Phase:             corev1.PodPending,
		ContainerStatuses: []corev1.ContainerStatus{{Name: DebugPodContainerName, State: state}},
	}
}

// The shell may attach only once the debugger container runs.
func TestWaitForDebugPodReturnsWhenDebuggerRuns(t *testing.T) {
	fastDebugPodPolling(t, time.Second)
	service := debugPodService(t,
		corev1.PodStatus{Phase: corev1.PodPending},
		debuggerStatus(corev1.ContainerState{Waiting: &corev1.ContainerStateWaiting{Reason: "ContainerCreating"}}),
		debuggerStatus(corev1.ContainerState{Running: &corev1.ContainerStateRunning{}}),
	)

	require.NoError(t, service.WaitForDebugPod(context.Background(), DebugPodNamespace, "node-debugger-worker-1-abcde"))
}

// A shell that cannot start (for example /bin/bash missing from busybox) must
// report kubelet's reason instead of waiting for the timeout.
func TestWaitForDebugPodReportsDebuggerExit(t *testing.T) {
	fastDebugPodPolling(t, time.Minute)
	service := debugPodService(t, debuggerStatus(corev1.ContainerState{Terminated: &corev1.ContainerStateTerminated{
		Reason: "StartError", Message: `exec: "/bin/bash": stat /bin/bash: no such file or directory`, ExitCode: 128,
	}}))

	err := service.WaitForDebugPod(context.Background(), DebugPodNamespace, "node-debugger-worker-1-abcde")
	require.ErrorContains(t, err, "StartError")
	require.ErrorContains(t, err, `exec: "/bin/bash"`)
}

// Image pull failures (wrong tag, missing registry credentials) do not fix
// themselves within the start window, so they fail at once with kubelet's message.
func TestWaitForDebugPodReportsImagePullFailure(t *testing.T) {
	fastDebugPodPolling(t, time.Minute)
	service := debugPodService(t, debuggerStatus(corev1.ContainerState{Waiting: &corev1.ContainerStateWaiting{
		Reason: "ErrImagePull", Message: `failed to pull image "busybox:nope": not found`,
	}}))

	err := service.WaitForDebugPod(context.Background(), DebugPodNamespace, "node-debugger-worker-1-abcde")
	require.ErrorContains(t, err, "ErrImagePull")
	require.ErrorContains(t, err, `busybox:nope`)
}

// A pod pinned to a node bypasses the scheduler; kubelet rejects one it cannot
// admit (a full node) by failing the pod, which must surface at once.
func TestWaitForDebugPodReportsKubeletRejection(t *testing.T) {
	fastDebugPodPolling(t, time.Minute)
	service := debugPodService(t, corev1.PodStatus{
		Phase: corev1.PodFailed, Reason: "OutOfpods",
		Message: "Node didn't have enough resource: pods, requested: 1, used: 110, capacity: 110",
	})

	err := service.WaitForDebugPod(context.Background(), DebugPodNamespace, "node-debugger-worker-1-abcde")
	require.ErrorContains(t, err, "OutOfpods")
	require.ErrorContains(t, err, "Node didn't have enough resource")
}

// A start that never reaches Running reports the last state kubelet reported,
// so the user can tell a slow pull from a node that never picked the pod up.
func TestWaitForDebugPodTimeoutReportsLastState(t *testing.T) {
	fastDebugPodPolling(t, 20*time.Millisecond)
	service := debugPodService(t, debuggerStatus(corev1.ContainerState{Waiting: &corev1.ContainerStateWaiting{Reason: "ContainerCreating"}}))

	err := service.WaitForDebugPod(context.Background(), DebugPodNamespace, "node-debugger-worker-1-abcde")
	require.ErrorContains(t, err, "timed out")
	require.ErrorContains(t, err, "ContainerCreating")
}

// Session cleanup deletes the debug pod; a pod that is already gone (the shell
// exited and someone removed it) is not a cleanup failure.
func TestDeleteDebugPodToleratesMissingPod(t *testing.T) {
	pod := &corev1.Pod{ObjectMeta: metav1.ObjectMeta{Namespace: DebugPodNamespace, Name: "node-debugger-worker-1-abcde"}}
	client := fake.NewClientset(pod)
	service := NewService(common.Dependencies{Logger: applog.Noop, KubernetesClient: client})

	require.NoError(t, service.DeleteDebugPod(context.Background(), DebugPodNamespace, pod.Name))
	_, err := client.CoreV1().Pods(DebugPodNamespace).Get(context.Background(), pod.Name, metav1.GetOptions{})
	require.True(t, apierrors.IsNotFound(err), "debug pod still exists: %v", err)
	require.NoError(t, service.DeleteDebugPod(context.Background(), DebugPodNamespace, pod.Name))
}

// A debug pod removed while it starts (by a user or a policy controller) fails
// the start at once instead of waiting out the start timeout.
func TestWaitForDebugPodReportsPodRemovedDuringStart(t *testing.T) {
	fastDebugPodPolling(t, time.Minute)
	client := fake.NewClientset()
	service := NewService(common.Dependencies{Logger: applog.Noop, KubernetesClient: client})

	err := service.WaitForDebugPod(context.Background(), DebugPodNamespace, "node-debugger-worker-1-abcde")

	require.ErrorContains(t, err, "failed to read debug pod")
	require.True(t, apierrors.IsNotFound(errors.Unwrap(err)), "unexpected error: %v", err)
}
