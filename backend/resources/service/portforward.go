package service

import (
	"context"
	"fmt"

	"github.com/luxury-yacht/app/backend/resources/common"
	corev1 "k8s.io/api/core/v1"
	discoveryv1 "k8s.io/api/discovery/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
)

// ForwardPodName finds a ready pod backing the named service via its endpoint slices.
func ForwardPodName(ctx context.Context, client kubernetes.Interface, namespace, name string) (string, error) {
	slices, err := client.DiscoveryV1().EndpointSlices(namespace).List(ctx, metav1.ListOptions{
		LabelSelector: discoveryv1.LabelServiceName + "=" + name,
	})
	if err != nil {
		return "", fmt.Errorf("failed to get endpoint slices for service: %w", err)
	}
	if len(slices.Items) == 0 {
		return "", fmt.Errorf("no endpoint slices found for service %s", name)
	}
	for _, slice := range slices.Items {
		for _, endpoint := range slice.Endpoints {
			if podName, ok := readyPodNameForEndpoint(ctx, client, namespace, endpoint); ok {
				return podName, nil
			}
		}
	}
	return "", fmt.Errorf("no ready pod found for service %s", name)
}

func readyPodNameForEndpoint(ctx context.Context, client kubernetes.Interface, namespace string, endpoint discoveryv1.Endpoint) (string, bool) {
	if endpoint.Conditions.Ready == nil || !*endpoint.Conditions.Ready {
		return "", false
	}
	target := endpoint.TargetRef
	if target == nil || target.APIVersion != corev1.SchemeGroupVersion.String() || target.Kind != "Pod" || target.Name == "" {
		return "", false
	}
	// The forwarding destination and permission check both use the service namespace.
	if target.Namespace != "" && target.Namespace != namespace {
		return "", false
	}
	pod, err := client.CoreV1().Pods(namespace).Get(ctx, target.Name, metav1.GetOptions{})
	if err != nil || !common.IsPodReady(pod) {
		return "", false
	}
	return target.Name, true
}
