package pods

import (
	"context"
	"fmt"

	"github.com/luxury-yacht/app/backend/resources/common"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
)

// ForwardPodName verifies the named pod exists and is ready, returning its name.
func ForwardPodName(ctx context.Context, client kubernetes.Interface, namespace, name string) (string, error) {
	pod, err := client.CoreV1().Pods(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return "", fmt.Errorf("failed to get pod: %w", err)
	}
	if !common.IsPodReady(pod) {
		return "", fmt.Errorf("pod %s is not ready", name)
	}
	return name, nil
}
