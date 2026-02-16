/*
 * backend/resources/pods/debug.go
 *
 * Ephemeral debug container creation.
 * - Creates an ephemeral container on a running pod.
 * - Polls until the container reaches Running state.
 */

package pods

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/luxury-yacht/app/backend/resources/types"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

var (
	// debugContainerPollInterval controls how frequently pod status is checked.
	// Tests can override this for faster timeout coverage.
	debugContainerPollInterval = 500 * time.Millisecond
	// debugContainerPollTimeout controls how long to wait for Running status.
	// Tests can override this for faster timeout coverage.
	debugContainerPollTimeout = 30 * time.Second
)

// CreateDebugContainer adds an ephemeral debug container to the specified pod
// and waits for it to reach Running state.
func (s *Service) CreateDebugContainer(namespace, podName, image, targetContainer string) (*types.DebugContainerResponse, error) {
	if s.deps.KubernetesClient == nil {
		return nil, fmt.Errorf("kubernetes client not initialized")
	}
	if namespace == "" {
		return nil, fmt.Errorf("namespace is required")
	}
	if podName == "" {
		return nil, fmt.Errorf("pod name is required")
	}
	if image == "" {
		return nil, fmt.Errorf("image is required")
	}

	ctx, cancel := context.WithTimeout(s.ctx(), debugContainerPollTimeout)
	defer cancel()

	pod, err := s.deps.KubernetesClient.CoreV1().Pods(namespace).Get(ctx, podName, metav1.GetOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to get pod: %w", err)
	}

	// Generate a short deterministic prefix for easier operator recognition.
	containerName := fmt.Sprintf("debug-%s", uuid.NewString()[:8])
	ephemeral := corev1.EphemeralContainer{
		EphemeralContainerCommon: corev1.EphemeralContainerCommon{
			Name:  containerName,
			Image: image,
			Stdin: true,
			TTY:   true,
		},
	}
	if targetContainer != "" {
		ephemeral.TargetContainerName = targetContainer
	}

	pod.Spec.EphemeralContainers = append(pod.Spec.EphemeralContainers, ephemeral)
	if _, err := s.deps.KubernetesClient.CoreV1().Pods(namespace).UpdateEphemeralContainers(ctx, podName, pod, metav1.UpdateOptions{}); err != nil {
		return nil, fmt.Errorf("failed to create debug container: %w", err)
	}

	if err := s.waitForEphemeralContainer(ctx, namespace, podName, containerName); err != nil {
		return nil, fmt.Errorf("debug container %s created but failed to start: %w", containerName, err)
	}

	return &types.DebugContainerResponse{
		ContainerName: containerName,
		PodName:       podName,
		Namespace:     namespace,
	}, nil
}

// waitForEphemeralContainer polls pod status until the named ephemeral container is Running.
func (s *Service) waitForEphemeralContainer(ctx context.Context, namespace, podName, containerName string) error {
	ticker := time.NewTicker(debugContainerPollInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return fmt.Errorf("timed out waiting for debug container %q to start", containerName)
		case <-ticker.C:
			pod, err := s.deps.KubernetesClient.CoreV1().Pods(namespace).Get(ctx, podName, metav1.GetOptions{})
			if err != nil {
				return fmt.Errorf("failed to poll pod status: %w", err)
			}
			for _, status := range pod.Status.EphemeralContainerStatuses {
				if status.Name == containerName && status.State.Running != nil {
					return nil
				}
			}
		}
	}
}
