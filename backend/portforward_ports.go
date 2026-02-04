/*
 * backend/portforward_ports.go
 *
 * Fetches container ports for port forwarding targets.
 * - Resolves the target to a pod and extracts exposed ports.
 * - Used by the frontend modal when ports aren't pre-populated.
 */

package backend

import (
	"context"
	"fmt"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// ContainerPortInfo describes a port exposed by a container.
type ContainerPortInfo struct {
	Port     int    `json:"port"`
	Name     string `json:"name,omitempty"`
	Protocol string `json:"protocol,omitempty"`
}

// GetTargetPorts returns the container ports for a given target resource.
// It resolves the target to a pod and extracts all unique container ports.
func (a *App) GetTargetPorts(clusterID, namespace, targetKind, targetName string) ([]ContainerPortInfo, error) {
	deps, _, err := a.resolveClusterDependencies(clusterID)
	if err != nil {
		return nil, fmt.Errorf("failed to resolve cluster: %w", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// Get the pod for this target.
	podName, err := resolvePodForTarget(ctx, deps.KubernetesClient, namespace, targetKind, targetName)
	if err != nil {
		return nil, err
	}

	pod, err := deps.KubernetesClient.CoreV1().Pods(namespace).Get(ctx, podName, metav1.GetOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to get pod: %w", err)
	}

	// Collect unique ports from all containers.
	var ports []ContainerPortInfo
	seen := make(map[int]bool)

	for _, container := range pod.Spec.Containers {
		for _, port := range container.Ports {
			if seen[int(port.ContainerPort)] {
				continue
			}
			seen[int(port.ContainerPort)] = true
			ports = append(ports, ContainerPortInfo{
				Port:     int(port.ContainerPort),
				Name:     port.Name,
				Protocol: string(port.Protocol),
			})
		}
	}

	return ports, nil
}
