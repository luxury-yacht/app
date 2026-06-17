package service

import (
	"context"
	"fmt"

	"github.com/luxury-yacht/app/backend/resources/common"
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
			if endpoint.Conditions.Ready == nil || !*endpoint.Conditions.Ready {
				continue
			}
			if endpoint.TargetRef == nil || endpoint.TargetRef.Kind != "Pod" {
				continue
			}
			pod, err := client.CoreV1().Pods(namespace).Get(ctx, endpoint.TargetRef.Name, metav1.GetOptions{})
			if err != nil {
				continue
			}
			if common.IsPodReady(pod) {
				return endpoint.TargetRef.Name, nil
			}
		}
	}
	return "", fmt.Errorf("no ready pod found for service %s", name)
}
