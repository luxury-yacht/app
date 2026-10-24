/*
 * backend/resources/nodes/debug_pod.go
 *
 * Node debug pods for the node shell.
 * - Builds the pod `kubectl debug node/<name> --profile=sysadmin` creates.
 * - Creates it, waits for its debugger container to run, and deletes it.
 */

package nodes

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/luxury-yacht/app/backend/internal/config"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	utilrand "k8s.io/apimachinery/pkg/util/rand"
	"k8s.io/utils/ptr"
)

const (
	// DebugPodNamespace is where node debug pods are created: kubectl's
	// namespace when the kubeconfig context names none.
	DebugPodNamespace = "default"
	// DebugPodContainerName is kubectl's container name for node debugging.
	DebugPodContainerName = "debugger"

	debugPodHostRootVolume = "host-root"
	debugPodManagedByLabel = "app.kubernetes.io/managed-by"
	debugPodManagedByValue = "luxury-yacht"
)

// debugPodNameSuffix generates kubectl's random pod-name suffix. Tests pin it.
var debugPodNameSuffix = utilrand.String

// NewDebugPod builds the pod `kubectl debug node/<name> --profile=sysadmin
// -it` creates (kubectl v0.37.1 generateNodeDebugPod plus the sysadmin
// profile): a privileged container pinned to the node, tolerating every taint,
// sharing the host's network, PID, and IPC namespaces, with the host root
// filesystem mounted at /host. A nil command runs the image's entrypoint.
func NewDebugPod(nodeName, image string, command []string) *corev1.Pod {
	return &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      fmt.Sprintf("node-debugger-%s-%s", nodeName, debugPodNameSuffix(5)),
			Namespace: DebugPodNamespace,
			Labels:    map[string]string{debugPodManagedByLabel: debugPodManagedByValue},
		},
		Spec: corev1.PodSpec{
			Containers: []corev1.Container{{
				Name:                     DebugPodContainerName,
				Image:                    image,
				Command:                  command,
				Stdin:                    true,
				TTY:                      true,
				TerminationMessagePolicy: corev1.TerminationMessageReadFile,
				SecurityContext:          &corev1.SecurityContext{Privileged: ptr.To(true)},
				VolumeMounts:             []corev1.VolumeMount{{Name: debugPodHostRootVolume, MountPath: "/host"}},
			}},
			NodeName:      nodeName,
			RestartPolicy: corev1.RestartPolicyNever,
			Tolerations:   []corev1.Toleration{{Operator: corev1.TolerationOpExists}},
			HostNetwork:   true,
			HostPID:       true,
			HostIPC:       true,
			Volumes: []corev1.Volume{{
				Name:         debugPodHostRootVolume,
				VolumeSource: corev1.VolumeSource{HostPath: &corev1.HostPathVolumeSource{Path: "/"}},
			}},
		},
	}
}

var (
	// debugPodPollInterval and debugPodStartTimeout pace WaitForDebugPod. Tests
	// shorten them.
	debugPodPollInterval = config.NodeDebugPodPollInterval
	debugPodStartTimeout = config.NodeDebugPodStartTimeout
)

// debugPodStartFailures are waiting reasons that will not clear within the
// start window (bad image references, missing pull credentials, invalid
// container config), so the wait reports them instead of timing out.
var debugPodStartFailures = map[string]bool{
	"ErrImagePull":               true,
	"ImagePullBackOff":           true,
	"InvalidImageName":           true,
	"ErrImageNeverPull":          true,
	"CreateContainerConfigError": true,
	"CreateContainerError":       true,
}

// CreateDebugPod creates a debug pod built by NewDebugPod with the caller's
// credentials, so RBAC and admission (Pod Security, policy webhooks) apply as
// for kubectl. The caller keeps the pod's identity: a failed create may still
// have created it (see DebugPodCreateMayHaveCommitted).
func (s *Service) CreateDebugPod(ctx context.Context, pod *corev1.Pod) (*corev1.Pod, error) {
	if err := s.ensureClient("Pods"); err != nil {
		return nil, err
	}
	created, err := s.deps.KubernetesClient.CoreV1().Pods(pod.Namespace).Create(ctx, pod, metav1.CreateOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to create debug pod: %w", err)
	}
	return created, nil
}

// DebugPodCreateMayHaveCommitted reports whether a failed create may still have
// created the pod: no API response arrived (transport error, timeout,
// cancellation) or the server failed after possibly committing (5xx). A 4xx
// rejection created nothing; AlreadyExists means the name is another pod's.
func DebugPodCreateMayHaveCommitted(err error) bool {
	var status apierrors.APIStatus
	if !errors.As(err, &status) {
		return true
	}
	code := status.Status().Code
	return code == 0 || code >= http.StatusInternalServerError
}

// WaitForDebugPod polls the debug pod until its debugger container runs. It
// fails at once when the container exits, the pod fails, or the container is
// stuck on an image or config error, and otherwise times out reporting the
// last state kubelet reported.
func (s *Service) WaitForDebugPod(ctx context.Context, namespace, name string) error {
	if err := s.ensureClient("Pods"); err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, debugPodStartTimeout)
	defer cancel()
	ticker := time.NewTicker(debugPodPollInterval)
	defer ticker.Stop()

	lastState := "the node has not started the pod"
	for {
		state, done, err := s.pollDebugPod(ctx, namespace, name)
		if done {
			return err
		}
		if state != "" {
			lastState = state
		}
		select {
		case <-ctx.Done():
			return debugPodWaitStopped(ctx, namespace, name, lastState)
		case <-ticker.C:
		}
	}
}

// debugPodWaitStopped explains why a wait ended early: the caller cancelled it
// (cluster removal, app shutdown) or the start window elapsed.
func debugPodWaitStopped(ctx context.Context, namespace, name, lastState string) error {
	if errors.Is(ctx.Err(), context.Canceled) {
		return fmt.Errorf("stopped waiting for debug pod %s/%s: %w", namespace, name, ctx.Err())
	}
	return fmt.Errorf("timed out waiting for debug pod %s/%s to start: %s", namespace, name, lastState)
}

// pollDebugPod reads the debug pod once. done reports a final outcome: the
// debugger runs (nil error) or cannot start. A read cut short by the start
// deadline is not final; the caller reports the timeout.
func (s *Service) pollDebugPod(ctx context.Context, namespace, name string) (string, bool, error) {
	pod, err := s.deps.KubernetesClient.CoreV1().Pods(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		if ctx.Err() != nil {
			return "", false, nil
		}
		return "", true, fmt.Errorf("failed to read debug pod %s/%s: %w", namespace, name, err)
	}
	state, running, startErr := debugPodStartState(pod)
	return state, running || startErr != nil, startErr
}

// debugPodStartState reports the debugger container's progress: whether it
// runs, a terminal start failure, or else a description of what it waits on.
func debugPodStartState(pod *corev1.Pod) (string, bool, error) {
	status := debuggerContainerStatus(pod)
	switch {
	case status != nil && status.State.Running != nil:
		return "", true, nil
	case status != nil && status.State.Terminated != nil:
		terminated := status.State.Terminated
		return "", false, fmt.Errorf("debugger container exited (code %d): %s",
			terminated.ExitCode, describeDebugPodState(terminated.Reason, terminated.Message))
	case pod.Status.Phase == corev1.PodFailed || pod.Status.Phase == corev1.PodSucceeded:
		return "", false, fmt.Errorf("debug pod %s: %s",
			strings.ToLower(string(pod.Status.Phase)), describeDebugPodState(pod.Status.Reason, pod.Status.Message))
	case status != nil && status.State.Waiting != nil:
		waiting := status.State.Waiting
		state := describeDebugPodState(waiting.Reason, waiting.Message)
		if debugPodStartFailures[waiting.Reason] {
			return "", false, fmt.Errorf("debugger container cannot start: %s", state)
		}
		return state, false, nil
	}
	return "the node has not started the pod", false, nil
}

func debuggerContainerStatus(pod *corev1.Pod) *corev1.ContainerStatus {
	for i := range pod.Status.ContainerStatuses {
		if pod.Status.ContainerStatuses[i].Name == DebugPodContainerName {
			return &pod.Status.ContainerStatuses[i]
		}
	}
	return nil
}

func describeDebugPodState(reason, message string) string {
	parts := make([]string, 0, 2)
	for _, part := range []string{reason, message} {
		if trimmed := strings.TrimSpace(part); trimmed != "" {
			parts = append(parts, trimmed)
		}
	}
	if len(parts) == 0 {
		return "no reason reported"
	}
	return strings.Join(parts, ": ")
}

// DeleteDebugPod removes a node shell's debug pod. A pod that is already gone
// counts as deleted.
func (s *Service) DeleteDebugPod(ctx context.Context, namespace, name string) error {
	if err := s.ensureClient("Pods"); err != nil {
		return err
	}
	err := s.deps.KubernetesClient.CoreV1().Pods(namespace).Delete(ctx, name, metav1.DeleteOptions{})
	if err != nil && !apierrors.IsNotFound(err) {
		return fmt.Errorf("failed to delete debug pod %s/%s: %w", namespace, name, err)
	}
	return nil
}
