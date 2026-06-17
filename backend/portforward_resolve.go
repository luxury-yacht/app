/*
 * backend/portforward_resolve.go
 *
 * Pod resolution logic for port forwarding.
 * - Resolves target resources (Pod/Deployment/StatefulSet/DaemonSet/Service) to pod names.
 * - Resolves Services via Service ports rather than backing pod container ports.
 */

package backend

import (
	"context"
	"fmt"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/util/intstr"
	"k8s.io/client-go/kubernetes"
)

type portForwardTargetRef struct {
	Namespace string
	Kind      string
	Group     string
	Version   string
	Name      string
}

type resolvedPortForwardTarget struct {
	PodName     string
	ForwardPort int
}

// resolvePodForTarget finds a ready pod for the given target resource via the
// kind's own resolver from the registry capability.
func resolvePodForTarget(
	ctx context.Context,
	client kubernetes.Interface,
	target portForwardTargetRef,
) (string, error) {
	capability, ok := lookupPortForwardTargetCapability(target.Kind)
	if !ok || capability.resolvePod == nil {
		return "", fmt.Errorf("unsupported target kind: %s", target.Kind)
	}
	return capability.resolvePod(ctx, client, target.Namespace, target.Name)
}

func resolvePortForwardDestination(
	ctx context.Context,
	client kubernetes.Interface,
	target portForwardTargetRef,
	requestedPort int,
) (resolvedPortForwardTarget, error) {
	capability, ok := lookupPortForwardTargetCapability(target.Kind)
	if !ok {
		return resolvedPortForwardTarget{}, fmt.Errorf("unsupported target kind: %s", target.Kind)
	}

	podName, err := resolvePodForTarget(ctx, client, target)
	if err != nil {
		return resolvedPortForwardTarget{}, err
	}

	if !capability.UsesServicePortSpec {
		return resolvedPortForwardTarget{PodName: podName, ForwardPort: requestedPort}, nil
	}

	service, err := client.CoreV1().Services(target.Namespace).Get(ctx, target.Name, metav1.GetOptions{})
	if err != nil {
		return resolvedPortForwardTarget{}, fmt.Errorf("failed to get service: %w", err)
	}

	servicePort, err := findForwardableServicePort(service, requestedPort)
	if err != nil {
		return resolvedPortForwardTarget{}, err
	}

	pod, err := client.CoreV1().Pods(target.Namespace).Get(ctx, podName, metav1.GetOptions{})
	if err != nil {
		return resolvedPortForwardTarget{}, fmt.Errorf("failed to get pod: %w", err)
	}

	podPort, err := resolveServiceTargetPortForPod(servicePort, pod)
	if err != nil {
		return resolvedPortForwardTarget{}, err
	}

	return resolvedPortForwardTarget{
		PodName:     podName,
		ForwardPort: podPort,
	}, nil
}

func findForwardableServicePort(service *corev1.Service, requestedPort int) (*corev1.ServicePort, error) {
	for i := range service.Spec.Ports {
		port := &service.Spec.Ports[i]
		if int(port.Port) != requestedPort {
			continue
		}
		if !isTCPProtocol(port.Protocol) {
			return nil, fmt.Errorf(
				"service port %d uses unsupported protocol %s",
				requestedPort,
				port.Protocol,
			)
		}
		return port, nil
	}

	return nil, fmt.Errorf("service %s does not expose TCP port %d", service.Name, requestedPort)
}

func resolveServiceTargetPortForPod(servicePort *corev1.ServicePort, pod *corev1.Pod) (int, error) {
	targetPort := servicePort.TargetPort

	switch targetPort.Type {
	case intstr.String:
		if targetPort.StrVal == "" {
			return int(servicePort.Port), nil
		}
		for _, container := range pod.Spec.Containers {
			for _, port := range container.Ports {
				if port.Name != targetPort.StrVal {
					continue
				}
				if !isTCPProtocol(port.Protocol) {
					continue
				}
				return int(port.ContainerPort), nil
			}
		}
		return 0, fmt.Errorf(
			"failed to resolve named targetPort %q for pod %s",
			targetPort.StrVal,
			pod.Name,
		)
	case intstr.Int:
		if targetPort.IntValue() > 0 {
			return targetPort.IntValue(), nil
		}
	}

	return int(servicePort.Port), nil
}

func isTCPProtocol(protocol corev1.Protocol) bool {
	return protocol == "" || protocol == corev1.ProtocolTCP
}

func normalizeProtocol(protocol corev1.Protocol) string {
	if protocol == "" {
		return string(corev1.ProtocolTCP)
	}
	return string(protocol)
}
