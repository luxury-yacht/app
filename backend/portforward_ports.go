/*
 * backend/portforward_ports.go
 *
 * Fetches forwardable ports for port forwarding targets.
 * - Pods/workloads expose TCP container ports from a resolved pod.
 * - Services expose TCP Service ports from the Service spec.
 * - Used by the frontend modal when ports aren't pre-populated.
 */

package backend

import (
	"context"
	"fmt"

	"github.com/luxury-yacht/app/backend/internal/config"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// ContainerPortInfo describes a port exposed by a container.
type ContainerPortInfo struct {
	Port     int    `json:"port"`
	Name     string `json:"name,omitempty"`
	Protocol string `json:"protocol,omitempty"`
}

// GetTargetPorts returns the TCP ports a target can be forwarded on.
func (a *App) GetTargetPorts(clusterID, namespace, targetKind, targetGroup, targetVersion, targetName string) ([]ContainerPortInfo, error) {
	deps, _, err := a.resolveClusterDependencies(clusterID)
	if err != nil {
		return nil, fmt.Errorf("failed to resolve cluster: %w", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), config.PortForwardTargetPortsTimeout)
	defer cancel()

	target := portForwardTargetRef{
		Namespace: namespace,
		Kind:      targetKind,
		Group:     targetGroup,
		Version:   targetVersion,
		Name:      targetName,
	}
	if err := validatePortForwardTargetGVK(target); err != nil {
		return nil, err
	}

	if target.Kind == "Service" {
		service, err := deps.KubernetesClient.CoreV1().Services(namespace).Get(ctx, targetName, metav1.GetOptions{})
		if err != nil {
			return nil, fmt.Errorf("failed to get service: %w", err)
		}
		return collectServicePorts(service), nil
	}

	podName, err := resolvePodForTarget(ctx, deps.KubernetesClient, target)
	if err != nil {
		return nil, err
	}

	pod, err := deps.KubernetesClient.CoreV1().Pods(namespace).Get(ctx, podName, metav1.GetOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to get pod: %w", err)
	}

	return collectPodPorts(pod), nil
}

func collectPodPorts(pod *corev1.Pod) []ContainerPortInfo {
	var ports []ContainerPortInfo
	seen := make(map[int]bool)

	for _, container := range pod.Spec.Containers {
		for _, port := range container.Ports {
			if !isTCPProtocol(port.Protocol) || seen[int(port.ContainerPort)] {
				continue
			}
			seen[int(port.ContainerPort)] = true
			ports = append(ports, ContainerPortInfo{
				Port:     int(port.ContainerPort),
				Name:     port.Name,
				Protocol: normalizeProtocol(port.Protocol),
			})
		}
	}

	return ports
}

func collectServicePorts(service *corev1.Service) []ContainerPortInfo {
	var ports []ContainerPortInfo

	for _, port := range service.Spec.Ports {
		if !isTCPProtocol(port.Protocol) {
			continue
		}
		ports = append(ports, ContainerPortInfo{
			Port:     int(port.Port),
			Name:     port.Name,
			Protocol: normalizeProtocol(port.Protocol),
		})
	}

	return ports
}
