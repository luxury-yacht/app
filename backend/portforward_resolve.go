/*
 * backend/portforward_resolve.go
 *
 * Pod resolution logic for port forwarding.
 * - Resolves target resources (Pod/Deployment/StatefulSet/DaemonSet/Service) to pod names.
 * - Follows kubectl behavior: for workloads, finds first ready pod with matching prefix.
 */

package backend

import (
	"context"
	"fmt"
	"strings"

	corev1 "k8s.io/api/core/v1"
	discoveryv1 "k8s.io/api/discovery/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
)

// resolvePodForTarget finds a ready pod for the given target resource.
// For Pods, returns the pod name directly after verifying it's ready.
// For Deployments/StatefulSets/DaemonSets, finds a ready pod with matching name prefix.
// For Services, finds a ready pod from the service's endpoints.
func resolvePodForTarget(
	ctx context.Context,
	client kubernetes.Interface,
	namespace, targetKind, targetName string,
) (string, error) {
	switch targetKind {
	case "Pod":
		return resolvePod(ctx, client, namespace, targetName)

	case "Deployment", "StatefulSet", "DaemonSet":
		return findReadyPodForWorkload(ctx, client, namespace, targetKind, targetName)

	case "Service":
		return findReadyPodForService(ctx, client, namespace, targetName)

	default:
		return "", fmt.Errorf("unsupported target kind: %s", targetKind)
	}
}

// resolvePod verifies that the named pod exists and is ready.
func resolvePod(
	ctx context.Context,
	client kubernetes.Interface,
	namespace, podName string,
) (string, error) {
	pod, err := client.CoreV1().Pods(namespace).Get(ctx, podName, metav1.GetOptions{})
	if err != nil {
		return "", fmt.Errorf("failed to get pod: %w", err)
	}
	if !isPodReady(pod) {
		return "", fmt.Errorf("pod %s is not ready", podName)
	}
	return podName, nil
}

// findReadyPodForWorkload finds a ready pod belonging to the workload.
// Pods created by workloads typically have the workload name as a prefix,
// following the kubectl convention for pod name matching.
func findReadyPodForWorkload(
	ctx context.Context,
	client kubernetes.Interface,
	namespace, kind, name string,
) (string, error) {
	pods, err := client.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return "", fmt.Errorf("failed to list pods: %w", err)
	}

	// Find the first ready pod with the workload name as prefix.
	for _, pod := range pods.Items {
		if !strings.HasPrefix(pod.Name, name) {
			continue
		}
		if isPodReady(&pod) {
			return pod.Name, nil
		}
	}

	return "", fmt.Errorf("no ready pod found for %s/%s", kind, name)
}

// findReadyPodForService finds a ready pod from the service's endpoint slices.
func findReadyPodForService(
	ctx context.Context,
	client kubernetes.Interface,
	namespace, serviceName string,
) (string, error) {
	// List EndpointSlices for this service using the standard label selector.
	slices, err := client.DiscoveryV1().EndpointSlices(namespace).List(ctx, metav1.ListOptions{
		LabelSelector: discoveryv1.LabelServiceName + "=" + serviceName,
	})
	if err != nil {
		return "", fmt.Errorf("failed to get endpoint slices for service: %w", err)
	}
	if len(slices.Items) == 0 {
		return "", fmt.Errorf("no endpoint slices found for service %s", serviceName)
	}

	// Iterate through endpoint slices to find a ready pod.
	for _, slice := range slices.Items {
		for _, endpoint := range slice.Endpoints {
			// Check if endpoint is ready.
			if endpoint.Conditions.Ready == nil || !*endpoint.Conditions.Ready {
				continue
			}
			if endpoint.TargetRef == nil || endpoint.TargetRef.Kind != "Pod" {
				continue
			}
			// Verify the pod is ready before returning.
			pod, err := client.CoreV1().Pods(namespace).Get(ctx, endpoint.TargetRef.Name, metav1.GetOptions{})
			if err != nil {
				continue
			}
			if isPodReady(pod) {
				return endpoint.TargetRef.Name, nil
			}
		}
	}

	return "", fmt.Errorf("no ready pod found for service %s", serviceName)
}

// isPodReady checks if a pod is in Running phase and has the Ready condition set to True.
func isPodReady(pod *corev1.Pod) bool {
	if pod.Status.Phase != corev1.PodRunning {
		return false
	}
	for _, cond := range pod.Status.Conditions {
		if cond.Type == corev1.PodReady && cond.Status == corev1.ConditionTrue {
			return true
		}
	}
	return false
}
