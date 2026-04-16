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
	"sort"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	discoveryv1 "k8s.io/api/discovery/v1"
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

// resolvePodForTarget finds a ready pod for the given target resource.
func resolvePodForTarget(
	ctx context.Context,
	client kubernetes.Interface,
	target portForwardTargetRef,
) (string, error) {
	switch target.Kind {
	case "Pod":
		return resolvePod(ctx, client, target.Namespace, target.Name)
	case "Deployment":
		return findReadyPodForDeployment(ctx, client, target.Namespace, target.Name)
	case "StatefulSet":
		return findReadyPodForStatefulSet(ctx, client, target.Namespace, target.Name)
	case "DaemonSet":
		return findReadyPodForDaemonSet(ctx, client, target.Namespace, target.Name)
	case "Service":
		return findReadyPodForService(ctx, client, target.Namespace, target.Name)
	default:
		return "", fmt.Errorf("unsupported target kind: %s", target.Kind)
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

func findReadyPodForDeployment(
	ctx context.Context,
	client kubernetes.Interface,
	namespace, name string,
) (string, error) {
	deployment, err := client.AppsV1().Deployments(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return "", fmt.Errorf("failed to get deployment: %w", err)
	}

	pods, replicaSets, err := listDeploymentPods(ctx, client, deployment)
	if err != nil {
		return "", err
	}

	return pickReadyPodName(filterPodsForDeployment(deployment, pods, replicaSets), "Deployment", name)
}

func findReadyPodForStatefulSet(
	ctx context.Context,
	client kubernetes.Interface,
	namespace, name string,
) (string, error) {
	statefulSet, err := client.AppsV1().StatefulSets(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return "", fmt.Errorf("failed to get statefulset: %w", err)
	}

	pods, err := listPodsForSelector(ctx, client, namespace, statefulSet.Spec.Selector)
	if err != nil {
		return "", err
	}

	return pickReadyPodName(filterPodsForStatefulSet(statefulSet, pods), "StatefulSet", name)
}

func findReadyPodForDaemonSet(
	ctx context.Context,
	client kubernetes.Interface,
	namespace, name string,
) (string, error) {
	daemonSet, err := client.AppsV1().DaemonSets(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return "", fmt.Errorf("failed to get daemonset: %w", err)
	}

	pods, err := listPodsForSelector(ctx, client, namespace, daemonSet.Spec.Selector)
	if err != nil {
		return "", err
	}

	return pickReadyPodName(filterPodsForDaemonSet(daemonSet, pods), "DaemonSet", name)
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

func resolvePortForwardDestination(
	ctx context.Context,
	client kubernetes.Interface,
	target portForwardTargetRef,
	requestedPort int,
) (resolvedPortForwardTarget, error) {
	podName, err := resolvePodForTarget(ctx, client, target)
	if err != nil {
		return resolvedPortForwardTarget{}, err
	}

	if target.Kind != "Service" {
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

func listDeploymentPods(
	ctx context.Context,
	client kubernetes.Interface,
	deployment *appsv1.Deployment,
) (*corev1.PodList, *appsv1.ReplicaSetList, error) {
	pods, err := listPodsForSelector(ctx, client, deployment.Namespace, deployment.Spec.Selector)
	if err != nil {
		return nil, nil, err
	}

	labelSelector, err := metav1.LabelSelectorAsSelector(deployment.Spec.Selector)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to build deployment selector: %w", err)
	}

	replicaSets, err := client.AppsV1().ReplicaSets(deployment.Namespace).List(ctx, metav1.ListOptions{
		LabelSelector: labelSelector.String(),
	})
	if err != nil {
		return nil, nil, fmt.Errorf("failed to list replicasets: %w", err)
	}

	return pods, replicaSets, nil
}

func listPodsForSelector(
	ctx context.Context,
	client kubernetes.Interface,
	namespace string,
	selector *metav1.LabelSelector,
) (*corev1.PodList, error) {
	if selector == nil {
		return nil, fmt.Errorf("selector is required")
	}

	labelSelector, err := metav1.LabelSelectorAsSelector(selector)
	if err != nil {
		return nil, fmt.Errorf("failed to build selector: %w", err)
	}

	pods, err := client.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{
		LabelSelector: labelSelector.String(),
	})
	if err != nil {
		return nil, fmt.Errorf("failed to list pods: %w", err)
	}

	return pods, nil
}

func filterPodsForDeployment(
	deployment *appsv1.Deployment,
	podList *corev1.PodList,
	replicaSets *appsv1.ReplicaSetList,
) []corev1.Pod {
	if podList == nil {
		return nil
	}

	replicaSetUIDs := map[string]struct{}{}
	if replicaSets != nil {
		for _, replicaSet := range replicaSets.Items {
			for _, owner := range replicaSet.OwnerReferences {
				if owner.Controller != nil && *owner.Controller && owner.Kind == "Deployment" && owner.UID == deployment.UID {
					replicaSetUIDs[string(replicaSet.UID)] = struct{}{}
					break
				}
			}
		}
	}

	var filtered []corev1.Pod
	for _, pod := range podList.Items {
		for _, owner := range pod.OwnerReferences {
			if owner.Kind != "ReplicaSet" {
				continue
			}
			if _, ok := replicaSetUIDs[string(owner.UID)]; ok {
				filtered = append(filtered, pod)
				break
			}
		}
	}

	return filtered
}

func filterPodsForStatefulSet(statefulSet *appsv1.StatefulSet, podList *corev1.PodList) []corev1.Pod {
	if podList == nil {
		return nil
	}

	var filtered []corev1.Pod
	for _, pod := range podList.Items {
		for _, owner := range pod.OwnerReferences {
			if owner.Controller != nil && *owner.Controller && owner.Kind == "StatefulSet" && owner.Name == statefulSet.Name {
				filtered = append(filtered, pod)
				break
			}
		}
	}

	return filtered
}

func filterPodsForDaemonSet(daemonSet *appsv1.DaemonSet, podList *corev1.PodList) []corev1.Pod {
	if podList == nil {
		return nil
	}

	var filtered []corev1.Pod
	for _, pod := range podList.Items {
		for _, owner := range pod.OwnerReferences {
			if owner.Controller != nil && *owner.Controller && owner.Kind == "DaemonSet" && owner.Name == daemonSet.Name {
				filtered = append(filtered, pod)
				break
			}
		}
	}

	return filtered
}

func pickReadyPodName(pods []corev1.Pod, kind, name string) (string, error) {
	readyNames := make([]string, 0, len(pods))
	for _, pod := range pods {
		if isPodReady(&pod) {
			readyNames = append(readyNames, pod.Name)
		}
	}
	if len(readyNames) == 0 {
		return "", fmt.Errorf("no ready pod found for %s/%s", kind, name)
	}
	sort.Strings(readyNames)
	return readyNames[0], nil
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

func validatePortForwardTargetGVK(target portForwardTargetRef) error {
	expected, ok := map[string]struct {
		group   string
		version string
	}{
		"Pod":         {group: "", version: "v1"},
		"Service":     {group: "", version: "v1"},
		"Deployment":  {group: "apps", version: "v1"},
		"StatefulSet": {group: "apps", version: "v1"},
		"DaemonSet":   {group: "apps", version: "v1"},
	}[target.Kind]
	if !ok {
		return fmt.Errorf("unsupported target kind: %s", target.Kind)
	}
	if target.Version == "" {
		return fmt.Errorf("target version is required")
	}
	if target.Group != expected.group || target.Version != expected.version {
		groupVersion := expected.version
		if expected.group != "" {
			groupVersion = expected.group + "/" + expected.version
		}
		return fmt.Errorf("target %s must use apiVersion %s", target.Kind, groupVersion)
	}
	return nil
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
