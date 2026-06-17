package common

import (
	"context"
	"fmt"
	"sort"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
)

// IsPodReady reports whether a pod is Running and has a true Ready condition.
func IsPodReady(pod *corev1.Pod) bool {
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

// ListPodsForSelector lists the pods in namespace matching the label selector.
func ListPodsForSelector(ctx context.Context, client kubernetes.Interface, namespace string, selector *metav1.LabelSelector) (*corev1.PodList, error) {
	if selector == nil {
		return nil, fmt.Errorf("selector is required")
	}
	labelSelector, err := metav1.LabelSelectorAsSelector(selector)
	if err != nil {
		return nil, fmt.Errorf("failed to build selector: %w", err)
	}
	pods, err := client.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{LabelSelector: labelSelector.String()})
	if err != nil {
		return nil, fmt.Errorf("failed to list pods: %w", err)
	}
	return pods, nil
}

// PickReadyPodName returns the first (lexicographically) ready pod name, or an
// error naming kind/name when none is ready.
func PickReadyPodName(pods []corev1.Pod, kind, name string) (string, error) {
	readyNames := make([]string, 0, len(pods))
	for i := range pods {
		if IsPodReady(&pods[i]) {
			readyNames = append(readyNames, pods[i].Name)
		}
	}
	if len(readyNames) == 0 {
		return "", fmt.Errorf("no ready pod found for %s/%s", kind, name)
	}
	sort.Strings(readyNames)
	return readyNames[0], nil
}
